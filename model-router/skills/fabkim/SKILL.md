---
name: fabkim
description: The FabKim flow - Claude orchestrates (plans, specs, verifies) while a Kimi Code worker (kimi-k3 by default) does 100% of the building through the local proxy. Use when you want Fable/Opus/Sonnet as orchestrator and Kimi as the build worker.
---

# FabKim - Claude orchestrator + Kimi worker

Same split as FabSol, but the worker is a Kimi model instead of GPT Sol.
Your main session model (Claude Fable / Opus 5 / Sonnet 5) orchestrates; whatever
`MODEL_ROUTER_MODEL` points at (default `kimi-k3`) does the building.

FabKim is self-contained from the management panel FabKim tab (like FabSol) —
toggle On there; you do **not** need the Moonshot tab. Moonshot is Kimi-only;
the Claude tab is Claude-only (no worker). Do not mix these modes.

You are the ORCHESTRATOR, running on this session's normal Claude login - NEVER
route this session through the proxy. All building is delegated to the WORKER
via headless `claude -p` calls through the local proxy (CLIProxyAPI), which
holds the user's Kimi login.

## Configuration (all changeable)

| Setting | Env var | Ships as |
|---|---|---|
| Proxy URL | `MODEL_ROUTER_URL` | `http://127.0.0.1:8317` |
| Proxy key | `MODEL_ROUTER_KEY` | `CHANGE_ME_LOCAL_SECRET` (an `api-keys` entry in your proxy config.yaml) |
| Worker model | `MODEL_ROUTER_MODEL` | `kimi-k3` |
| Worker effort | `MODEL_ROUTER_EFFORT` | `high` |
| Worker turn cap | `--max-turns` in the call below | `20` |

Any `kimi-*` ID your proxy serves works (for example `kimi-k2.7-code` for Kimi
Code highspeed/code tiers).

## The worker delegation call (Bash, one per build task)

```bash
ANTHROPIC_BASE_URL="${MODEL_ROUTER_URL:-http://127.0.0.1:8317}" \
ANTHROPIC_AUTH_TOKEN="${MODEL_ROUTER_KEY:-CHANGE_ME_LOCAL_SECRET}" \
claude -p "<self-contained task spec>" \
  --model "${MODEL_ROUTER_MODEL:-kimi-k3}" \
  --effort "${MODEL_ROUTER_EFFORT:-high}" \
  --bare --max-turns 20 --permission-mode acceptEdits \
&& ls -la <expected output paths> \
&& grep -c "<acceptance marker>" <built file>
```

`--bare` is safe for the worker because its auth comes from the env vars on the
call, not a stored login. The `&& ls && grep` tail is how the build's proof
comes back in the same tool result (rule 2 below).

## ORCHESTRATOR EFFICIENCY RULES (non-negotiable)

Every tool call you make is a full API round trip that re-sends your entire
context. Turns are the cost driver, so:

1. **You never write code.** The worker does 100% of the building. When a
   build misses, you delegate a fix task WITH the failure evidence attached -
   you do not open an editor yourself. The only things you write are specs,
   verdicts, and the final report.
2. **One compound command per delegation.** Chain the verification evidence
   onto the SAME Bash call as the delegation (the `&& ls && grep` tail above,
   plus targeted `head -40` slices if needed) so the build result AND its
   proof arrive in one tool result.
3. **Never read a whole built file into context.** It rides along in every
   later turn and you pay for it again each time. Verify with targeted
   `grep -c` / `head` / `tail` slices only.
4. **No exploratory reads before the spec.** If the brief touches existing
   code, gather everything in ONE batched Bash call (`ls` + `grep` + `head`
   slices), then write the spec.
5. **Target shape: 2 turns per task.** Turn 1 = spec + compound
   delegate-and-verify call. Turn 2 = report. Spend a third turn only on an
   actual failure.
6. **Run delegations in the FOREGROUND** - wait for each to finish. Never end
   the session with worker builds still in flight (fire-and-forget loses the
   build report). Independent tasks may run as parallel background calls, but
   collect all of them before reporting.

## Before the first delegation

Check the proxy is up. On Windows PowerShell, bare `curl` is an alias for
Invoke-WebRequest and will look "empty" / fail — always use `curl.exe`:

```powershell
curl.exe -s "$env:MODEL_ROUTER_URL/v1/models" -H "Authorization: Bearer $env:MODEL_ROUTER_KEY"
```

Git Bash / macOS / Linux:

```bash
curl.exe -s "${MODEL_ROUTER_URL:-http://127.0.0.1:8317}/v1/models" \
  -H "Authorization: Bearer ${MODEL_ROUTER_KEY:-CHANGE_ME_LOCAL_SECRET}"
```

It must list your Kimi worker model. If it does not respond, start it with
`start.bat` (or `scripts/start-proxy`) and re-check. If a delegation fails
with an auth error, STOP and tell the user their Kimi login needs a refresh.

If the preflight comes back empty on Windows, you almost certainly used `curl`
instead of `curl.exe` — retry with `curl.exe` before concluding the proxy is down.

## Phase 1 - ALIGN AND PLAN (you)

- Ask at least 3 alignment questions in ONE batch before any work: scope,
  constraints, what done looks like. Wait for answers. (Skip only if the brief
  explicitly says it is final and pre-aligned.)
- Write a short plan: numbered build tasks, each sized so a single headless
  call can finish it without asking questions.
- Show the plan in one screen or less. Get a go signal.

## Phase 2 - BUILD (the Kimi worker, headless)

- One delegation call per task, using the exact compound command shape above.
- Each task spec must be self-contained: exact file paths, what to create or
  change, acceptance criteria, what NOT to touch, and "verify your work, then
  report changed paths + how you verified".
- Make every creative and architectural call yourself, in the spec — the
  worker executes.

## Phase 3 - CHECK (you) - optional for quick tasks, recommended for real builds

- Judge from the compound command's evidence: file list, grep counts, targeted
  slices. Run the real verification (build command, test run) batched into as
  few Bash calls as possible.
- Misses go back to the worker as a fix delegation with the failure evidence
  attached. You do not fix code yourself.
- Report: what shipped, what was verified and how, anything left open -
  5 lines or fewer.

## Windows / Claude Desktop note

If a sandboxed Bash call cannot reach `127.0.0.1:8317`, re-run the same
`curl.exe` / `claude -p` check via Desktop Commander (or any host-side shell MCP).
On Windows PowerShell, always use `curl.exe` — never bare `curl` (it is an
alias for Invoke-WebRequest and FabKim preflight will look empty).
`.claude/settings.json` excludes `curl`, `curl.exe`, and `claude` from the
sandbox when FabKim is enabled from the management panel.
