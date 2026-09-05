# Portable Paths + App Settings Design

Approved 2026-07-21. Approach C: portable install root + local-settings companion (port 19890).

## Goals

1. Install works after rename or move (any drive) via `%~dp0` / `__dirname` and healed `CLIPROXY_DIR`.
2. Settings tab above Config Panel with Windows login start, Claude 5h controls, auth location (default fixed `C:\cli-proxy-api`, custom, portable automove), and Full QoL options.
3. Auth path always visible; Move / Auto-move (portable) supported.

## Persistence

- `app-settings.json` in install root
- `config.yaml` `auth-dir` updated when auth mode changes
- Windows Startup shortcut `CLIProxyAPI.lnk` → `start.bat`
