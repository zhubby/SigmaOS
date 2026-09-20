## Code Review Results

**Scope:** feature commit `e6361d0` plus the current working-tree fixes for persistent terminal tabs.

**Intent:** Provide per-root, machine-shared terminal tabs whose metadata survives reboot and whose tmux shells survive browser, API, and helper disconnects. Preserve legacy terminal clients and the existing single-user/local-network security boundary.

**Mode:** autofix; sequential main-thread review as required by repository instructions. No review subagents were dispatched.

**Review lenses:** correctness, testing, maintainability, project standards, API accessibility, API contracts, data integrity, reliability, TypeScript state races, and responsive frontend behavior.

### P1 -- High

All high-severity findings were fixed and verified; none remains open.

| # | File | Issue | Reviewer | Confidence | Route |
|---|------|-------|----------|------------|-------|
| 1 | `apps/api/src/lib/terminal-broker.ts` | Fire-and-forget tmux destruction allowed a tab row to be deleted even when the helper failed to destroy its shell | sequential correctness/data-integrity lens | 0.99 | `safe_auto -> review-fixer`, applied |
| 2 | `apps/api/src/lib/terminal-sessions.ts` | A terminal-helper restart was reported as a real shell exit, which stopped browser reconnection even though the persistent tmux session survived | sequential reliability lens | 0.98 | `safe_auto -> review-fixer`, applied |

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence | Route |
|---|------|-------|----------|------------|-------|
| 3 | `apps/web/src/components/workspace/LocalTerminalPanel.tsx` | Async mutations from an earlier root visit could overwrite state after switching away and back | sequential frontend-race lens | 0.97 | `safe_auto -> review-fixer`, applied |
| 4 | `apps/web/src/components/workspace/LocalTerminalPanel.tsx` | A recognized legacy localStorage ID was not cleared, allowing a deleted legacy tab to be imported again later | sequential correctness lens | 0.94 | `safe_auto -> review-fixer`, applied |
| 5 | `apps/web/src/components/workspace/LocalTerminalPanel.tsx` | The selected tab could remain outside the horizontally scrolled viewport after creating or activating later tabs | sequential responsive-UI lens | 0.98 | `safe_auto -> review-fixer`, applied |
| 6 | `apps/web/src/components/workspace/LocalTerminalPanel.tsx` | A successful WebSocket upgrade reset reconnect attempts before the helper returned `ready`, causing a 250ms reconnect loop during helper outages | Linux deployment verification | 0.99 | `safe_auto -> review-fixer`, applied |

### Applied Fixes

- Added a broker `destroy`/`destroyed` acknowledgement and propagated helper errors/timeouts so restart and delete return `503` without deleting metadata when shell destruction is unconfirmed.
- Classified helper transport loss as recoverable. The browser WebSocket now closes and reconnects to the stable tmux session; explicit tmux exit events still stop automatic reconnection.
- Guarded all tab mutation responses with both root identity and action version.
- Cleared legacy localStorage IDs after either successful import or successful recognition in shared server state.
- Kept the active ARIA tab visible with nearest horizontal scrolling.
- Reset terminal reconnect backoff only after the helper reports `ready`; failed connections now back off from 250ms to a 5s cap.
- Added cross-root WebSocket rejection, destroy-failure, restart consistency, broker acknowledgement, and recoverable reconnect tests.

### Plan Coverage

- Met: additive SQLite tab-set/tab model, root isolation, monotonic ordinals, active-neighbor selection, global limit, and title validation.
- Met: persistent tmux policy, stable session names, explicit destruction acknowledgement, idle/eviction exemptions, legacy non-persistent compatibility, and single-controller takeover.
- Met: complete REST surface, validation/status mapping, idempotent initialization/import, cross-root rejection, and backward-compatible WebSocket behavior.
- Met: top tablist, keyboard navigation, localized names, lazy xterm retention, active-only WebSocket, rename/restart/confirmed close, error/empty/takeover states, focus refresh, and responsive layouts.
- Met: API, helper, and workspace documentation.
- Met: database, protocol, helper policy, broker/session, route, frontend helper/component, full repository, and browser checks.

### Residual Actionable Work

None. No unresolved code finding is assigned to a downstream resolver, so no todo files were created.

### Agent-Native Gaps

None. Terminal tab metadata and lifecycle operations are available through the REST API; interactive shell I/O remains available through the documented WebSocket protocol.

### Deployment Notes

- Before rollout, back up the SQLite database and confirm the package includes the updated API and terminal-helper together.
- After startup, verify migration `015_terminal_tabs`, run `PRAGMA foreign_key_check`, and confirm every non-null `active_tab_id` belongs to the same root.
- Restart the terminal helper before the API, then verify existing persistent tabs reconnect and that explicit restart/delete removes the named tmux session.
- Monitor API/helper journals for destroy timeouts, capacity errors, or repeated reconnects. Keep `terminal.maxSessions` aligned in API and helper configuration.
- The migration is additive but has no down migration. Rollback to older binaries should use a matching database backup if schema rollback is required; machine reboot intentionally recreates shells without old process state or scrollback.

### Coverage

- No `docs/solutions/` directory exists, so there were no institutional solution notes to apply.
- Full gates passed: `npm run typecheck`, `npm run lint`, `npm test` (91 Vitest files, 598 tests, plus 5 documentation tests), and `npm run build`.
- Browser checks passed at 1440x900 and 375x812: auto-initialization, multiple tabs, active-tab scrolling, keyboard switching, rename, confirmation dialog layout, refresh persistence, and mobile overflow.
- Linux acceptance passed on Debian 13 ARM64 with Node 22 and tmux 3.5a. Real shell state survived browser refresh plus API and helper restarts; a second browser received control and the first stopped reconnecting after `taken_over`.
- Explicit restart replaced the stable tmux session and cleared shell state. Confirmed close removed both the database tab and tmux session; closing the last tab produced an initialized empty state and the next tab used the next monotonic ordinal.
- With the helper unavailable, delete returned `503` while preserving tab metadata. Reconnect intervals increased to the 5s cap and the browser recovered after the helper returned.
- Migration `015_terminal_tabs`, SQLite integrity, foreign keys, active-tab/root ownership, service health, NAS readiness, and system health all passed on the deployed host.
- Build output retained the repository's existing large-chunk and empty documentation i18n-collection warnings; neither is introduced by this feature.
- The feature package was deployed for acceptance; commit and push remained outside the review pass itself.

---

> **Verdict:** Ready with fixes and Linux acceptance.
>
> **Reasoning:** All confirmed findings are resolved, the full automated and responsive browser gates pass, and the persistent terminal lifecycle passed real Linux deployment verification.
