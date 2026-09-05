# Sidebar Auto-start 5h Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Claude 5h Auto-start toggle under the sidebar Operate group so it is always visible.

**Architecture:** Reuse `useClaudeAutostart` + `ToggleSwitch`. New thin presentational/wiring component mounted from `MainLayout` after Operate nav links. Styles live in `layout.scss` under a non-link sidebar row class.

**Tech Stack:** React, TypeScript, SCSS modules / global layout SCSS, existing companion API client.

## Global Constraints

- Reuse existing i18n keys (`claude_quota.autostart_*`); no new copy unless required for collapsed tooltip.
- Do not alter Quota or Settings toggle behavior.
- User rule: do not commit unless explicitly asked.

---

## File map

| File | Role |
|------|------|
| `panel-src/src/components/quota/ClaudeAutostartSidebarToggle.tsx` | Hook + ToggleSwitch wrapper; accepts `showLabel` |
| `panel-src/src/components/layout/MainLayout.tsx` | Render toggle at end of Operate `nav-group` |
| `panel-src/src/styles/layout.scss` | `.sidebar-autostart` row styles + collapsed centering |

---

### Task 1: Sidebar toggle component

- [ ] Create `ClaudeAutostartSidebarToggle.tsx` calling `useClaudeAutostart(true)`
- [ ] Pass `showLabel` to hide label when sidebar collapsed
- [ ] Wire disabled / title / aria from availability + loading/saving

### Task 2: Mount in MainLayout + styles

- [ ] After Operate group `items.map`, render `<ClaudeAutostartSidebarToggle showLabel={showSidebarLabels} />`
- [ ] Add `.sidebar-autostart` styles in `layout.scss` (expanded padding, collapsed center, hide label via prop not CSS text hacks)

### Task 3: Manual verify

- [ ] Expanded: label “Auto-start 5h”, toggles sync with Quota/Settings
- [ ] Collapsed: control remains usable with tooltip
- [ ] Offline worker: control disabled with offline hint
