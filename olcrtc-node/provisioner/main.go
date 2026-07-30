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
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) })
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
				"OLCRTC_VP8_FPS=25",
				"OLCRTC_VP8_BATCH_SIZE=1",
			},
			Labels:     map[string]string{"com.astracat.olcrtc.managed": "true", "com.astracat.olcrtc.subscription": req.SubscriptionID},
			HostConfig: dockerHostConfig{NetworkMode: "host", RestartPolicy: dockerRestartPolicy{Name: "unless-stopped"}},
		}
		if err := dockerJSON(r.Context(), docker, http.MethodPost, "/v1.41/containers/create?name="+url.QueryEscape(name), create, nil); err != nil {
			if strings.Contains(err.Error(), "Conflict") {
				writeError(w, http.StatusConflict, "instance already exists")
				return
			}
			writeError(w, http.StatusBadGateway, "Docker create failed: "+err.Error())
			return
		}
		if err := dockerJSON(r.Context(), docker, http.MethodPost, "/v1.41/containers/"+url.PathEscape(name)+"/start", nil, nil); err != nil {
			_ = dockerJSON(r.Context(), docker, http.MethodDelete, "/v1.41/containers/"+url.PathEscape(name)+"?force=true", nil, nil)
			writeError(w, http.StatusBadGateway, "Docker start failed: "+err.Error())
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
