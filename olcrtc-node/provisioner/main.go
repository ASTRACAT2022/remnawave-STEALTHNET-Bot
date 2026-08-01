package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const dockerSocket = "/var/run/docker.sock"

var safeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,128}$`)

type provisionRequest struct {
	SubscriptionID string `json:"subscriptionId"`
	Provider       string `json:"provider"`
	RoomID         string `json:"roomId"`
	EncryptionKey  string `json:"encryptionKey"`
}

type dockerCreateRequest struct {
	Image      string            `json:"Image"`
	Env        []string          `json:"Env"`
	Labels     map[string]string `json:"Labels"`
	HostConfig dockerHostConfig  `json:"HostConfig"`
}

type dockerHostConfig struct {
	NetworkMode   string              `json:"NetworkMode"`
	RestartPolicy dockerRestartPolicy `json:"RestartPolicy"`
}

type dockerRestartPolicy struct {
	Name string `json:"Name"`
}

type dockerInspectResponse struct {
	State struct {
		Running  bool   `json:"Running"`
		Status   string `json:"Status"`
		Error    string `json:"Error"`
		ExitCode int    `json:"ExitCode"`
	} `json:"State"`
}

func main() {
	token := strings.TrimSpace(os.Getenv("OLCRTC_PROVISIONER_TOKEN"))
	if len(token) < 32 {
		log.Fatal("OLCRTC_PROVISIONER_TOKEN must be set to a random value of at least 32 characters")
	}
	listen := envOr("OLCRTC_PROVISIONER_LISTEN", "127.0.0.1:9500")
	image := envOr("OLCRTC_IMAGE", "astracat/olcrtc-node:latest")

	docker := &http.Client{
		Timeout: 25 * time.Second,
		Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", dockerSocket)
		}},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := dockerJSON(ctx, docker, http.MethodGet, "/v1.41/version", nil, nil); err != nil {
			writeError(w, http.StatusServiceUnavailable, "Docker недоступен: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /v1/instances", authenticated(token, func(w http.ResponseWriter, r *http.Request) {
		var req provisionRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if err := validate(req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		name := containerName(req.SubscriptionID)
		create := dockerCreateRequest{
			Image: image,
			Env: []string{
				"OLCRTC_PROVIDER=" + req.Provider,
				"OLCRTC_TRANSPORT=vp8channel",
				"OLCRTC_ROOM_ID=" + req.RoomID,
				"OLCRTC_KEY=" + req.EncryptionKey,
				"OLCRTC_VP8_FPS=30",
				"OLCRTC_VP8_BATCH_SIZE=64",
			},
			Labels:     map[string]string{"com.astracat.olcrtc.managed": "true", "com.astracat.olcrtc.subscription": req.SubscriptionID},
			HostConfig: dockerHostConfig{NetworkMode: "host", RestartPolicy: dockerRestartPolicy{Name: "unless-stopped"}},
		}
		createdNew := false
		if err := dockerJSON(r.Context(), docker, http.MethodPost, "/v1.41/containers/create?name="+url.QueryEscape(name), create, nil); err != nil {
			// A retry can reach this point after Docker already created the
			// container but before BillingStyle received the first response.
			// Treat it as idempotent: retain the existing container and verify it.
			if !strings.Contains(err.Error(), "409") && !strings.Contains(err.Error(), "Conflict") {
				writeError(w, http.StatusBadGateway, "Docker create failed: "+err.Error())
				return
			}
		} else {
			createdNew = true
		}
		if err := ensureContainerRunning(r.Context(), docker, name); err != nil {
			// Never delete an existing instance merely because a retry failed.
			if createdNew {
				_ = dockerJSON(r.Context(), docker, http.MethodDelete, "/v1.41/containers/"+url.PathEscape(name)+"?force=true", nil, nil)
			}
			writeError(w, http.StatusBadGateway, "OlcRTC container did not start: "+err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"instanceId": req.SubscriptionID, "container": name})
	}))
	mux.HandleFunc("DELETE /v1/instances/{id}", authenticated(token, func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !safeID.MatchString(id) {
			writeError(w, http.StatusBadRequest, "invalid instance id")
			return
		}
		name := containerName(id)
		_ = dockerJSON(r.Context(), docker, http.MethodPost, "/v1.41/containers/"+url.PathEscape(name)+"/stop?t=10", nil, nil)
		if err := dockerJSON(r.Context(), docker, http.MethodDelete, "/v1.41/containers/"+url.PathEscape(name)+"?force=true", nil, nil); err != nil && !strings.Contains(err.Error(), "404") {
			writeError(w, http.StatusBadGateway, "Docker remove failed: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}))

	log.Printf("OlcRTC provisioner listening on %s", listen)
	log.Fatal(http.ListenAndServe(listen, mux))
}

func authenticated(token string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func validate(req provisionRequest) error {
	if !safeID.MatchString(req.SubscriptionID) {
		return errors.New("invalid subscriptionId")
	}
	if req.Provider != "telemost" && req.Provider != "wbstream" {
		return errors.New("provider must be telemost or wbstream")
	}
	if strings.TrimSpace(req.RoomID) == "" || len(req.RoomID) > 1000 {
		return errors.New("roomId is required")
	}
	if !regexp.MustCompile(`^[0-9A-Fa-f]{64}$`).MatchString(req.EncryptionKey) {
		return errors.New("encryptionKey must be 64 hexadecimal characters")
	}
	return nil
}

func dockerJSON(ctx context.Context, client *http.Client, method, path string, input any, output any) error {
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, body)
	if err != nil {
		return err
	}
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Docker API %s", resp.Status)
	}
	if output != nil {
		return json.NewDecoder(resp.Body).Decode(output)
	}
	return nil
}

func waitForContainerRunning(parent context.Context, client *http.Client, name string) error {
	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	for {
		var inspect dockerInspectResponse
		if err := dockerJSON(ctx, client, http.MethodGet, "/v1.41/containers/"+url.PathEscape(name)+"/json", nil, &inspect); err != nil {
			return err
		}
		if inspect.State.Running {
			return nil
		}
		if inspect.State.Status == "exited" || inspect.State.Status == "dead" {
			if inspect.State.Error != "" {
				return errors.New(inspect.State.Error)
			}
			return fmt.Errorf("status=%s, exitCode=%d", inspect.State.Status, inspect.State.ExitCode)
		}
		select {
		case <-ctx.Done():
			return errors.New("timeout waiting for Docker container state=running")
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func ensureContainerRunning(ctx context.Context, client *http.Client, name string) error {
	var inspect dockerInspectResponse
	if err := dockerJSON(ctx, client, http.MethodGet, "/v1.41/containers/"+url.PathEscape(name)+"/json", nil, &inspect); err != nil {
		return err
	}
	if inspect.State.Running {
		return nil
	}
	if err := dockerJSON(ctx, client, http.MethodPost, "/v1.41/containers/"+url.PathEscape(name)+"/start", nil, nil); err != nil {
		// Docker reports 304 when another concurrent request just started it.
		if !strings.Contains(err.Error(), "304") && !strings.Contains(err.Error(), "already started") {
			return err
		}
	}
	return waitForContainerRunning(ctx, client, name)
}

func containerName(id string) string { return "olcrtc-sub-" + strings.ToLower(id) }
func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}
