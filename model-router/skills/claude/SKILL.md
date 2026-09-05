---
name: claude
description: Run a full Claude Code session on a Claude model using the normal direct Claude login (not the proxy). Use when the user invokes /claude, wants Claude-only, or does not want FabSol/FabKim/Moonshot routing.
---

# Claude - Claude-only session (direct login)

You are running (or about to run) a **full session on a Claude model** with the
normal Claude Code login. This session is **Claude-only** — do not set
`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`, and do not route this session
through CLIProxyAPI.

- Need **Claude orchestrator + GPT Sol worker**? That is **FabSol** (`/fabsol`).
- Need **Claude orchestrator + Kimi worker**? That is **FabKim** (`/fabkim`).
- Need **Kimi-only** (session model is Kimi via the proxy)? That is **Moonshot**
  (`/moonshot`).

Default model: `claude-fable-5`. Any `claude-*` ID Claude Code serves works
(for example `claude-opus-5`, `claude-sonnet-5`).

## Configuration

| Setting | Env var | Ships as |
|---|---|---|
| Session model | (claude `--model`) | `claude-fable-5` |
| Effort | `MODEL_ROUTER_EFFORT` (unused here) | `high` |

This mode does **not** use `MODEL_ROUTER_URL` / `MODEL_ROUTER_KEY` for the
session itself. Those vars are for FabSol/FabKim workers only.

## Preflight (before coding)

Confirm `claude` is on PATH. On Windows PowerShell:

```powershell
where.exe claude
claude --version
```

If missing: `npm install -g @anthropic-ai/claude-code`. If not logged in, run
`claude` once and complete the browser login.

## Session launch shape

When starting by hand (the panel Claude toggle does this for you):

```powershell
Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue
claude --model claude-fable-5
```

Do **not** point this session at `http://127.0.0.1:8317`.

## How to work in a Claude session

1. **You are the coder.** This session IS the build model — do not delegate to
   a second worker unless the user explicitly asks for a FabSol/FabKim split.
2. **Stay on the selected Claude model.** Do not silently switch to Kimi or
   another provider mid-task.
3. **Verify with evidence.** After edits, run targeted checks (`ls`, `grep`,
   build/test commands) and report what you verified.
4. **Keep scopes tight.** Prefer small, complete steps over large speculative
   rewrites unless the brief demands a broad change.

## Hard rule

NEVER set `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` on this session.
Anthropic's terms ban using a Claude subscription login inside third-party
tools. Routed env belongs on FabSol/FabKim worker calls (or a Moonshot
session) only.
