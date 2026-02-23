package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"time"

	"pepoapple/agent/internal/api"
	"pepoapple/agent/internal/config"
	"pepoapple/agent/internal/runtime"
)

func main() {
	cfg := config.Load()
	client := api.NewClient(cfg.APIBaseURL)
	manager := runtime.NewManager(cfg)

	log.Printf("agent started, backend=%s", cfg.APIBaseURL)
	ticker := time.NewTicker(cfg.HeartbeatInterval)
	defer ticker.Stop()

	for {
		awg2Version, singboxVersion := manager.EngineVersions()
		if err := client.Heartbeat(cfg.NodeToken, awg2Version, singboxVersion); err != nil {
			log.Printf("heartbeat error: %v", err)
		}

		desired, err := client.DesiredConfig(cfg.NodeToken)
		if err != nil {
			log.Printf("desired-config error: %v", err)
		} else {
			_ = writeJSON(cfg.DesiredPath, desired.DesiredConfig)
			if desired.DesiredConfigRevision > desired.AppliedConfigRevision {
				if err := manager.Validate(desired.DesiredConfig, desired.EngineSingboxEnabled, desired.EngineAwg2Enabled); err != nil {
					_ = client.ApplyResult(cfg.NodeToken, desired.DesiredConfigRevision, "failed", map[string]interface{}{"error": err.Error()})
				} else if err := manager.Apply(desired.DesiredConfig, desired.EngineSingboxEnabled, desired.EngineAwg2Enabled); err != nil {
					_ = client.ApplyResult(cfg.NodeToken, desired.DesiredConfigRevision, "failed", map[string]interface{}{"error": err.Error()})
				} else {
					_ = client.ApplyResult(cfg.NodeToken, desired.DesiredConfigRevision, "success", map[string]interface{}{})
				}
			}
		}

		<-ticker.C
	}
}

func writeJSON(path string, payload map[string]interface{}) error {
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, raw, 0o600)
}
