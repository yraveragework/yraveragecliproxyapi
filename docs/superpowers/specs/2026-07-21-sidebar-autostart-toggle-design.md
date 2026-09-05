# Sidebar Auto-start 5h Toggle Design

Approved 2026-07-21. Approach A: single Operate-group control.

## Goal

Expose the existing Claude 5-hour global auto-start toggle in the sidebar so operators can verify and change it from Dashboard / FabSol (and any other route) without opening Quota or Settings.

## Placement

- Sidebar **Operate** group (`navGroups` id `operate`)
- Rendered once, after Dashboard + FabSol (and Quick Start if present)
- Always visible on every authenticated route

## Behavior

- Wire to existing `useClaudeAutostart(true)` → `settings.globalEnabled` / `setGlobalEnabled`
- Same enable/disable semantics as Quota Claude card header and Settings
- Disabled when companion worker offline, or while loading/saving
- Tooltip: `claude_quota.autostart_global_hint` when available, else `claude_quota.autostart_worker_offline`
- Notifications remain inside `useClaudeAutostart` (no duplicate toasts)

## UI

- Expanded sidebar: compact `ToggleSwitch` with label from `claude_quota.autostart_global_label` (“Auto-start 5h”)
- Collapsed sidebar: track only (no text label); `title` / `aria-label` still set
- Quiet sidebar row styling (not a card); must not look like a `nav-item` link

## Scope

**In**

- Small reusable component under `panel-src/src/components/quota/` (or layout)
- Mount in `MainLayout` Operate group
- Light SCSS in `layout.scss` (or co-located module)

**Out**

- No changes to Quota / Settings toggle behavior
- No per-account autostart in sidebar
- No duplicate toggles on Dashboard / FabSol page headers

## Self-review

- No placeholders or TBD left
- Single source of truth: companion API via existing hook
- Ambiguity resolved: one control for Operate group, not per-row
- Scope stays UI wiring only
