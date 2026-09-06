# CLIProxyAPI Custom Overlay (FabSol + Settings + Autostart)

Windows and macOS overlay on **CLIProxyAPI 7.2.x** that adds a customized management panel and local helper workers:

- **FabSol** tab (Operate) — Claude orchestrator + GPT Sol worker (self-contained toggle)
- **FabKim** tab (Operate) — Claude orchestrator + Kimi worker (same FabSol flow; default worker `kimi-k3`)
- **Claude** tab (Operate) — **Claude-only** session (direct Claude login, not the proxy)
- **Moonshot** tab (Operate) — **Kimi-only** session (any `kimi-*`, default `kimi-k3`); not the Claude+Kimi split
- Starting any one of FabSol / FabKim / Claude / Moonshot automatically turns the others off so modes do not mix
- **Settings** tab (local settings worker)
- **Claude 5h autostart** worker (quota / schedule helpers)
- GitHub **update checker** helpers
- Bundled **model-router** skills for Claude tooling

This repository ships the overlay source, static panel build (`static/management.html`), and launcher scripts. The `cli-proxy-api.exe` binary is **not** committed — download it from upstream releases.

## Credits

- Upstream proxy: [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
- Upstream management center: [router-for-me/Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)

Custom FabSol / Settings / Autostart additions in this tree are a community overlay; see `NOTICE.md` and `LICENSE`.

## macOS

For a Mac-native installation, see [macOS setup](docs/MACOS.md). Use `start.command` / `stop.command`; the browser panel runs locally on the Mac and agent terminals open on demand. macOS Terminal acceptance testing is still required.

## Windows requirements

- Windows (amd64)
- [Node.js](https://nodejs.org/) (for FabSol, Settings, and Claude autostart workers)
- `cli-proxy-api.exe` from a CLIProxyAPI **windows_amd64** release matching **7.2.102+**

## Setup

1. Download the `CLIProxyAPI_*_windows_amd64` release asset matching **7.2.102+** and place `cli-proxy-api.exe` in this folder.
2. Copy `config.yaml.example` → `config.yaml` and set `api-keys` plus `remote-management.secret-key` (plaintext on first run; the binary will bcrypt-hash it into `config.yaml`).
3. If you use `start-ui.bat`, copy `webui/panel-password.txt.example` → `webui/panel-password.txt`.
4. Run `start.bat`.
5. Open http://127.0.0.1:8317/management.html and sign in with your management secret (Bearer / panel password).

Helpers:

- `stop.bat` — stop proxy + workers
- `update.bat` / `tools\Update-CLIProxyAPI.ps1` — update helpers
- `claude-fabsol.bat` — FabSol-related launcher
- `install-claude-plugins.bat` — export `/fabsol`, `/fabkim`, `/claude`, `/moonshot` into Claude Code (skills + plugin marketplace)

## Features

| Area | What it does |
|------|----------------|
| FabSol tab | Operate workflow UI backed by `claude-fabsol-worker` (default http://127.0.0.1:19889/) |
| FabKim tab | Operate workflow UI backed by `claude-fabkim-worker` (default http://127.0.0.1:19892/) |
| Claude tab | Claude-only session UI backed by `claude-session-worker` (default http://127.0.0.1:19893/); native Claude login |
| Moonshot tab | Kimi Code session UI backed by `moonshot-worker` (default http://127.0.0.1:19891/); pick any `kimi-*` model |
| Andon / heartbeat | Live status signals in the panel |
| Settings tab | Local settings via `local-settings` worker (http://127.0.0.1:19890/) |
| Claude 5h autostart | `claude-autostart` worker (http://127.0.0.1:19888/) |
| Update checker | Scripts under `tools\` for GitHub release checks |
| model-router | Skills / agents under `model-router\` |

## Rebuild the management panel

```bat
cd panel-src
npm install
npm run build
```

Then copy `panel-src/dist/index.html` to `static/management.html` (keep `static/management.html.stock` as the stock backup).

## Security

- **Never commit** `config.yaml`, `auth/`, `webui/panel-password.txt`, or real API keys / management passwords.
- Prefer `allow-remote: false` and bind `host: "127.0.0.1"` unless you intentionally expose the panel.
- `cli-proxy-api.exe` is gitignored; obtain it only from trusted upstream releases.

## License

See `LICENSE` (upstream) and `NOTICE.md` for overlay notes.
