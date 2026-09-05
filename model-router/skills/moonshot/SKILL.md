---
name: moonshot
description: Run a full Claude Code / Kimi Code session on a Moonshot Kimi model via the local CLIProxyAPI proxy. Use when the user invokes /moonshot, wants Kimi Code, Kimi K3, or any kimi-* model as the active coding session.
---

# Moonshot - Kimi Code session via the proxy

You are running (or about to run) a **full session on a Kimi model** through
CLIProxyAPI. This session is **Kimi-only** — the session model is the selected
`kimi-*` ID for the entire terminal (and Cursor, when Moonshot routing is on).
Do not silently switch to Claude mid-session.

- Need **Claude-only** (direct Claude login, no proxy)? That is **Claude**
  (`/claude`).
- Need **Claude orchestrator + Kimi worker**? That is **FabKim** (`/fabkim`), not
  Moonshot. FabKim launches Claude as the session model and routes builds to Kimi.
- Need **Claude orchestrator + GPT Sol worker**? That is **FabSol** (`/fabsol`).

Default model: `kimi-k3`. Any `kimi-*` ID your proxy serves works (for example
`kimi-k2.7-code` for Kimi Code highspeed/code tiers).

## Cursor (use Kimi Code API in this IDE)

When Moonshot is toggled On in the management panel, it writes Cursor's
**Override OpenAI Base URL** to the local proxy (`http://127.0.0.1:8317/v1`)
and adds the selected Kimi model to Cursor's model list.

One-time in Cursor Settings → Models:

1. OpenAI API Key = your proxy `api-keys` value (default `CHANGE_ME_LOCAL_SECRET`) — toggle **On**
2. Confirm Override OpenAI Base URL = `http://127.0.0.1:8317/v1`
3. Reload Window, then pick the Kimi model in the model picker

While the override is on, Cursor built-in subscription models that don't accept
custom keys may be unavailable. Toggle Moonshot Off to restore the previous
Cursor routing settings.

## Configuration

| Setting | Env var | Ships as |
|---|---|---|
| Proxy URL | `MODEL_ROUTER_URL` | `http://127.0.0.1:8317` |
| Proxy key | `MODEL_ROUTER_KEY` | `CHANGE_ME_LOCAL_SECRET` |
| Session model | `MODEL_ROUTER_MODEL` | `kimi-k3` |
| Effort | `MODEL_ROUTER_EFFORT` | `high` |

## Preflight (before coding)

On Windows PowerShell always use `curl.exe` (plain `curl` is an alias):

```powershell
curl.exe -s "$env:MODEL_ROUTER_URL/v1/models" -H "Authorization: Bearer $env:MODEL_ROUTER_KEY"
```

Confirm the selected Kimi model appears. If the proxy is down, start it from
the management panel (`start.bat`) or `scripts/start-proxy`, then re-check.

## Session launch shape

When starting by hand (the panel Moonshot toggle does this for you):

```powershell
$env:ANTHROPIC_BASE_URL = $env:MODEL_ROUTER_URL
$env:ANTHROPIC_AUTH_TOKEN = $env:MODEL_ROUTER_KEY
claude --model $env:MODEL_ROUTER_MODEL
```

Or: `scripts/session.ps1 kimi-k3` (any `kimi-*` ID).

## How to work in a Moonshot session

1. **You are the coder.** This session IS the build model — do not delegate to
   a second worker unless the user explicitly asks for a FabSol-style split.
2. **Stay on the selected Kimi model.** Do not silently switch to Claude or
   another provider mid-task.
3. **Verify with evidence.** After edits, run targeted checks (`ls`, `grep`,
   build/test commands) and report what you verified.
4. **Keep scopes tight.** Prefer small, complete steps over large speculative
   rewrites unless the brief demands a broad change.

## Switching Kimi models

Pick any ID from `/v1/models` that starts with `kimi-` (examples: `kimi-k3`,
`kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, `kimi-k2.5`, `kimi-k2.6`,
`kimi-k2-thinking`). Set it in the panel Moonshot tab, or:

```powershell
$env:MODEL_ROUTER_MODEL = "kimi-k2.7-code"
claude --model kimi-k2.7-code
```

## Hard rule

Never put a Claude **subscription** OAuth login through the proxy. Moonshot
sessions authenticate via `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` pointing
at the local proxy, which holds the Kimi login.

## Windows note

If a sandboxed shell cannot reach `127.0.0.1:8317`, re-run preflight via a
host-side shell. Prefer `curl.exe` over PowerShell's `curl` alias.
