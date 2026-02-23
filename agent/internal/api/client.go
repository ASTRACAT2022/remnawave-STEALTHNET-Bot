package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type DesiredConfigResponse struct {
	NodeID                string                 `json:"node_id"`
	DesiredConfigRevision int                    `json:"desired_config_revision"`
	AppliedConfigRevision int                    `json:"applied_config_revision"`
	EngineAwg2Enabled     bool                   `json:"engine_awg2_enabled"`
	EngineSingboxEnabled  bool                   `json:"engine_singbox_enabled"`
	DesiredConfig         map[string]interface{} `json:"desired_config"`
}

func NewClient(baseURL string) *Client {
	return &Client{baseURL: baseURL, http: &http.Client{}}
}

func (c *Client) Heartbeat(nodeToken, awg2Version, singboxVersion string) error {
	payload := map[string]string{
		"node_token":             nodeToken,
		"engine_awg2_version":    awg2Version,
		"engine_singbox_version": singboxVersion,
	}
	return c.postJSON("/agent/heartbeat", payload, nil)
}

func (c *Client) DesiredConfig(nodeToken string) (DesiredConfigResponse, error) {
	var out DesiredConfigResponse
	endpoint := fmt.Sprintf("%s/agent/desired-config?node_token=%s", c.baseURL, url.QueryEscape(nodeToken))
	resp, err := c.http.Get(endpoint)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return out, fmt.Errorf("desired-config failed: %d: %s", resp.StatusCode, string(body))
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}

func (c *Client) ApplyResult(nodeToken string, revision int, status string, details map[string]interface{}) error {
	payload := map[string]interface{}{
		"node_token":              nodeToken,
		"applied_config_revision": revision,
		"status":                  status,
		"details":                 details,
	}
	return c.postJSON("/agent/apply-result", payload, nil)
}

func (c *Client) ReportUsage(nodeToken, userUUID string, bytesUsed int64, deviceHash string) error {
	payload := map[string]interface{}{
		"node_token":  nodeToken,
		"user_uuid":   userUUID,
		"bytes_used":  bytesUsed,
		"device_hash": deviceHash,
	}
	return c.postJSON("/agent/report-usage", payload, nil)
}

func (c *Client) postJSON(path string, payload interface{}, out interface{}) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := c.http.Post(c.baseURL+path, "application/json", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("request failed: %d: %s", resp.StatusCode, string(body))
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}
