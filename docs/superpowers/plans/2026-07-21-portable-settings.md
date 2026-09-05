# Portable Settings Implementation Plan

> **For agentic workers:** implement as shipped; this plan documents what was done.

**Goal:** Rename/move-safe install + Settings tab (login start, Claude 5h, auth location, Full QoL).

**Status:** Implemented 2026-07-21.

## Delivered

1. `local-settings/` companion on port 19890
2. `app-settings.json` + path healing in `start.bat` / worker boot
3. Panel `SettingsPage` at `/settings` above Config Panel
4. Auth modes fixed/custom/portable + move/automove
5. Built `static/management.html`
