# Contributing

## Scope

This repo is a Windows overlay (panel customizations + local workers) on CLIProxyAPI. Prefer small, focused changes.

## Before opening a PR

1. Do not commit secrets: `config.yaml`, `auth/`, `webui/panel-password.txt`, `*.log`, or `cli-proxy-api.exe`.
2. Use `config.yaml.example` and `webui/panel-password.txt.example` for shared defaults.
3. If you change the panel UI, rebuild from `panel-src` and update `static/management.html`.
4. Keep workers free of committed `worker.log` / `state.json`.

## Local check

```bat
start.bat
REM open http://127.0.0.1:8317/management.html
stop.bat
```
