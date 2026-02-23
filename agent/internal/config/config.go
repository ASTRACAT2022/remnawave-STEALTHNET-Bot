package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	APIBaseURL        string
	NodeToken         string
	HeartbeatInterval time.Duration
	DesiredPath       string
	ConfigPath        string
	BackupPath        string
	RuntimeMode       string

	SingboxConfigPath     string
	SingboxBackupPath     string
	SingboxRunCommand     string
	SingboxVersionCommand string
	SingboxCheckCommand   string
	SingboxCheckTimeout   time.Duration
	SingboxPIDPath        string

	Awg2ConfigPath     string
	Awg2BackupPath     string
	Awg2RunCommand     string
	Awg2VersionCommand string
	Awg2PIDPath        string

	SystemdSingboxService string
	SystemdAwg2Service    string
}

func Load() Config {
	interval := 15
	if raw := os.Getenv("AGENT_HEARTBEAT_INTERVAL_SEC"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			interval = parsed
		}
	}

	checkTimeout := 20
	if raw := os.Getenv("AGENT_SINGBOX_CHECK_TIMEOUT_SEC"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			checkTimeout = parsed
		}
	}

	return Config{
		APIBaseURL:        getenv("AGENT_API_BASE_URL", "http://127.0.0.1:8080"),
		NodeToken:         getenv("AGENT_NODE_TOKEN", "change-me"),
		HeartbeatInterval: time.Duration(interval) * time.Second,
		DesiredPath:       getenv("AGENT_DESIRED_PATH", "/var/lib/pepoapple/desired.json"),
		ConfigPath:        getenv("AGENT_CONFIG_PATH", "/etc/pepoapple/runtime.json"),
		BackupPath:        getenv("AGENT_BACKUP_PATH", "/var/lib/pepoapple/runtime.backup.json"),
		RuntimeMode:       getenv("AGENT_RUNTIME_MODE", "process"),

		SingboxConfigPath:     getenv("AGENT_SINGBOX_CONFIG_PATH", "/var/lib/pepoapple/singbox.json"),
		SingboxBackupPath:     getenv("AGENT_SINGBOX_BACKUP_PATH", "/var/lib/pepoapple/singbox.backup.json"),
		SingboxRunCommand:     getenv("AGENT_SINGBOX_RUN_COMMAND", "sing-box run -D /var/lib/pepoapple -c /var/lib/pepoapple/singbox.json"),
		SingboxVersionCommand: getenv("AGENT_SINGBOX_VERSION_COMMAND", "sing-box version"),
		SingboxCheckCommand:   getenv("AGENT_SINGBOX_CHECK_COMMAND", "sing-box check -c {config_path}"),
		SingboxCheckTimeout:   time.Duration(checkTimeout) * time.Second,
		SingboxPIDPath:        getenv("AGENT_SINGBOX_PID_PATH", "/var/lib/pepoapple/singbox.pid"),

		Awg2ConfigPath:     getenv("AGENT_AWG2_CONFIG_PATH", "/var/lib/pepoapple/awg2.json"),
		Awg2BackupPath:     getenv("AGENT_AWG2_BACKUP_PATH", "/var/lib/pepoapple/awg2.backup.json"),
		Awg2RunCommand:     getenv("AGENT_AWG2_RUN_COMMAND", "awg2 -f wg0"),
		Awg2VersionCommand: getenv("AGENT_AWG2_VERSION_COMMAND", "awg2 --version"),
		Awg2PIDPath:        getenv("AGENT_AWG2_PID_PATH", "/var/lib/pepoapple/awg2.pid"),

		SystemdSingboxService: getenv("AGENT_SYSTEMD_SINGBOX_SERVICE", "sing-box"),
		SystemdAwg2Service:    getenv("AGENT_SYSTEMD_AWG2_SERVICE", "awg2"),
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
