package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"pepoapple/agent/internal/config"
)

var supportedSingboxInboundTypes = map[string]struct{}{
	"direct":      {},
	"mixed":       {},
	"socks":       {},
	"http":        {},
	"shadowsocks": {},
	"vmess":       {},
	"trojan":      {},
	"naive":       {},
	"hysteria2":   {},
	"shadowtls":   {},
	"tuic":        {},
	"hysteria":    {},
	"anytls":      {},
	"vless":       {},
	"tun":         {},
	"redirect":    {},
	"tproxy":      {},
}

type Manager struct {
	ConfigPath string
	BackupPath string

	RuntimeMode string

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

func NewManager(cfg config.Config) *Manager {
	return &Manager{
		ConfigPath: cfg.ConfigPath,
		BackupPath: cfg.BackupPath,

		RuntimeMode: cfg.RuntimeMode,

		SingboxConfigPath:     cfg.SingboxConfigPath,
		SingboxBackupPath:     cfg.SingboxBackupPath,
		SingboxRunCommand:     cfg.SingboxRunCommand,
		SingboxVersionCommand: cfg.SingboxVersionCommand,
		SingboxCheckCommand:   cfg.SingboxCheckCommand,
		SingboxCheckTimeout:   cfg.SingboxCheckTimeout,
		SingboxPIDPath:        cfg.SingboxPIDPath,

		Awg2ConfigPath:     cfg.Awg2ConfigPath,
		Awg2BackupPath:     cfg.Awg2BackupPath,
		Awg2RunCommand:     cfg.Awg2RunCommand,
		Awg2VersionCommand: cfg.Awg2VersionCommand,
		Awg2PIDPath:        cfg.Awg2PIDPath,

		SystemdSingboxService: cfg.SystemdSingboxService,
		SystemdAwg2Service:    cfg.SystemdAwg2Service,
	}
}

func (m *Manager) EngineVersions() (string, string) {
	return m.detectVersion(m.Awg2VersionCommand), m.detectVersion(m.SingboxVersionCommand)
}

func (m *Manager) detectVersion(versionCommand string) string {
	if strings.TrimSpace(versionCommand) == "" {
		return "unknown"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", versionCommand)
	out, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "timeout"
		}
		return "unavailable"
	}
	text := strings.TrimSpace(string(out))
	if text == "" {
		return "unknown"
	}
	line := strings.Split(text, "\n")[0]
	line = strings.TrimSpace(line)
	if len(line) > 64 {
		return line[:64]
	}
	return line
}

func (m *Manager) Validate(cfg map[string]interface{}, singboxEnabled bool, awg2Enabled bool) error {
	hasEngineConfig := false
	if singboxEnabled {
		singboxCfg, present, err := extractSingboxConfig(cfg)
		if err != nil {
			return err
		}
		if present {
			hasEngineConfig = true
			inboundsRaw, ok := singboxCfg["inbounds"]
			if !ok {
				return fmt.Errorf("sing-box config validation failed: missing inbounds")
			}
			if err := validateSingboxInbounds(inboundsRaw); err != nil {
				return fmt.Errorf("sing-box config validation failed: %w", err)
			}
			if err := m.validateSingboxConfig(singboxCfg); err != nil {
				return err
			}
		}
	}
	if awg2Enabled {
		_, present, err := extractAwg2Config(cfg)
		if err != nil {
			return err
		}
		if present {
			hasEngineConfig = true
		}
	}
	if !hasEngineConfig {
		return fmt.Errorf("config validation failed: no engine config found (`singbox`, root sing-box fields, or `awg2`)")
	}
	return nil
}

func (m *Manager) Apply(cfg map[string]interface{}, singboxEnabled bool, awg2Enabled bool) error {
	var singboxCfg map[string]interface{}
	var singboxPresent bool
	var awg2Cfg map[string]interface{}
	var awg2Present bool
	var err error

	if singboxEnabled {
		singboxCfg, singboxPresent, err = extractSingboxConfig(cfg)
		if err != nil {
			return err
		}
	}
	if awg2Enabled {
		awg2Cfg, awg2Present, err = extractAwg2Config(cfg)
		if err != nil {
			return err
		}
	}
	effectiveSingbox := singboxEnabled && singboxPresent
	effectiveAwg2 := awg2Enabled && awg2Present

	if err := m.backupCurrent(effectiveSingbox, effectiveAwg2); err != nil {
		return err
	}
	if err := writeJSON(m.ConfigPath, cfg); err != nil {
		_ = m.Rollback(effectiveSingbox, effectiveAwg2)
		return err
	}
	if effectiveSingbox {
		if err := writeJSON(m.SingboxConfigPath, singboxCfg); err != nil {
			_ = m.Rollback(effectiveSingbox, effectiveAwg2)
			return err
		}
	}
	if effectiveAwg2 {
		if err := writeJSON(m.Awg2ConfigPath, awg2Cfg); err != nil {
			_ = m.Rollback(effectiveSingbox, effectiveAwg2)
			return err
		}
	}
	if err := m.reloadServices(effectiveSingbox, effectiveAwg2); err != nil {
		_ = m.Rollback(effectiveSingbox, effectiveAwg2)
		return err
	}
	return nil
}

func (m *Manager) Rollback(singboxEnabled bool, awg2Enabled bool) error {
	if err := restoreFromBackup(m.ConfigPath, m.BackupPath); err != nil {
		return err
	}
	if singboxEnabled {
		if err := restoreFromBackup(m.SingboxConfigPath, m.SingboxBackupPath); err != nil {
			return err
		}
	}
	if awg2Enabled {
		if err := restoreFromBackup(m.Awg2ConfigPath, m.Awg2BackupPath); err != nil {
			return err
		}
	}
	return m.reloadServices(singboxEnabled, awg2Enabled)
}

func (m *Manager) backupCurrent(singboxEnabled bool, awg2Enabled bool) error {
	if err := backupFile(m.ConfigPath, m.BackupPath); err != nil {
		return err
	}
	if singboxEnabled {
		if err := backupFile(m.SingboxConfigPath, m.SingboxBackupPath); err != nil {
			return err
		}
	}
	if awg2Enabled {
		if err := backupFile(m.Awg2ConfigPath, m.Awg2BackupPath); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) reloadServices(singboxEnabled bool, awg2Enabled bool) error {
	if strings.EqualFold(m.RuntimeMode, "systemd") {
		return m.reloadSystemd(singboxEnabled, awg2Enabled)
	}
	return m.reloadProcesses(singboxEnabled, awg2Enabled)
}

func (m *Manager) reloadSystemd(singboxEnabled bool, awg2Enabled bool) error {
	var failures []string
	if singboxEnabled {
		if err := runCommand("systemctl", "restart", m.SystemdSingboxService); err != nil {
			failures = append(failures, fmt.Sprintf("sing-box systemd restart failed: %v", err))
		}
	}
	if awg2Enabled {
		if err := runCommand("systemctl", "restart", m.SystemdAwg2Service); err != nil {
			failures = append(failures, fmt.Sprintf("awg2 systemd restart failed: %v", err))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf(strings.Join(failures, "; "))
	}
	return nil
}

func (m *Manager) reloadProcesses(singboxEnabled bool, awg2Enabled bool) error {
	var failures []string
	if singboxEnabled {
		if err := restartProcess(m.SingboxPIDPath, m.SingboxRunCommand, "sing-box"); err != nil {
			failures = append(failures, err.Error())
		}
	}
	if awg2Enabled {
		if err := restartProcess(m.Awg2PIDPath, m.Awg2RunCommand, "awg2"); err != nil {
			failures = append(failures, err.Error())
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf(strings.Join(failures, "; "))
	}
	return nil
}

func restartProcess(pidPath string, command string, processName string) error {
	if strings.TrimSpace(command) == "" {
		return fmt.Errorf("%s process restart failed: empty command", processName)
	}
	if err := stopProcess(pidPath); err != nil {
		return fmt.Errorf("%s process restart failed while stopping previous process: %w", processName, err)
	}

	cmd := exec.Command("sh", "-c", command)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%s process restart failed: %w", processName, err)
	}
	if err := ensureParentDir(pidPath); err != nil {
		return err
	}
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(cmd.Process.Pid)), 0o600); err != nil {
		return fmt.Errorf("%s process restart failed: %w", processName, err)
	}
	return nil
}

func stopProcess(pidPath string) error {
	raw, err := os.ReadFile(pidPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		_ = os.Remove(pidPath)
		return nil
	}
	proc, err := os.FindProcess(pid)
	if err == nil {
		_ = proc.Signal(syscall.SIGTERM)
		time.Sleep(300 * time.Millisecond)
		_ = proc.Signal(syscall.SIGKILL)
	}
	_ = os.Remove(pidPath)
	return nil
}

func runCommand(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			return err
		}
		return fmt.Errorf("%w: %s", err, message)
	}
	return nil
}

func backupFile(sourcePath string, backupPath string) error {
	raw, err := os.ReadFile(sourcePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := ensureParentDir(backupPath); err != nil {
		return err
	}
	return os.WriteFile(backupPath, raw, 0o600)
}

func restoreFromBackup(targetPath string, backupPath string) error {
	raw, err := os.ReadFile(backupPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := ensureParentDir(targetPath); err != nil {
		return err
	}
	return os.WriteFile(targetPath, raw, 0o600)
}

func extractSingboxConfig(cfg map[string]interface{}) (map[string]interface{}, bool, error) {
	if raw, ok := cfg["singbox"]; ok {
		out, err := asMap(raw, "singbox")
		return out, true, err
	}
	if _, ok := cfg["inbounds"]; ok {
		// Backward compatibility: root payload was sing-box config.
		return cfg, true, nil
	}
	return nil, false, nil
}

func extractAwg2Config(cfg map[string]interface{}) (map[string]interface{}, bool, error) {
	if raw, ok := cfg["awg2"]; ok {
		out, err := asMap(raw, "awg2")
		return out, true, err
	}
	if raw, ok := cfg["amneziawg"]; ok {
		out, err := asMap(raw, "amneziawg")
		return out, true, err
	}
	return nil, false, nil
}

func asMap(value interface{}, fieldName string) (map[string]interface{}, error) {
	out, ok := value.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("%s config validation failed: expected object", fieldName)
	}
	return out, nil
}

func writeJSON(path string, payload map[string]interface{}) error {
	if err := ensureParentDir(path); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func ensureParentDir(path string) error {
	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return nil
	}
	return os.MkdirAll(dir, 0o755)
}

func validateSingboxInbounds(rawInbounds interface{}) error {
	inbounds, ok := rawInbounds.([]interface{})
	if !ok {
		return fmt.Errorf("inbounds must be an array")
	}

	for index, rawInbound := range inbounds {
		inbound, ok := rawInbound.(map[string]interface{})
		if !ok {
			return fmt.Errorf("inbound[%d] must be an object", index)
		}
		inboundType, ok := inbound["type"].(string)
		if !ok || strings.TrimSpace(inboundType) == "" {
			return fmt.Errorf("inbound[%d].type must be a non-empty string", index)
		}
		normalizedType := strings.ToLower(strings.TrimSpace(inboundType))
		if _, supported := supportedSingboxInboundTypes[normalizedType]; !supported {
			return fmt.Errorf("inbound[%d].type `%s` is not supported", index, inboundType)
		}
	}

	return nil
}

func (m *Manager) validateSingboxConfig(config map[string]interface{}) error {
	checkCommand := strings.TrimSpace(m.SingboxCheckCommand)
	if checkCommand == "" {
		return nil
	}

	tmpFile, err := os.CreateTemp("", "pepoapple-singbox-*.json")
	if err != nil {
		return fmt.Errorf("failed to prepare temporary sing-box config: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if err := json.NewEncoder(tmpFile).Encode(config); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("failed to write temporary sing-box config: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("failed to finalize temporary sing-box config: %w", err)
	}

	quotedPath := shellQuote(tmpPath)
	if strings.Contains(checkCommand, "{config_path}") {
		checkCommand = strings.ReplaceAll(checkCommand, "{config_path}", quotedPath)
	} else {
		checkCommand = fmt.Sprintf("%s %s", checkCommand, quotedPath)
	}

	timeout := m.SingboxCheckTimeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", checkCommand)
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("sing-box config validation timed out after %s", timeout)
		}
		message := sanitizeCommandOutput(output)
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("sing-box config validation failed: %s", message)
	}

	return nil
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func sanitizeCommandOutput(output []byte) string {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return ""
	}
	const maxLen = 512
	if len(text) > maxLen {
		return text[:maxLen]
	}
	return text
}
