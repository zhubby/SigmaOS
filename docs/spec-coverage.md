# SigmaOS v1 Spec Coverage

## Phase 1 - Read-only MVP

- Monorepo workspaces: `apps/web`, `apps/api`, `apps/worker`, `apps/indexer`, `apps/scheduler`, `packages/db`, `packages/nas-tools`, `packages/agent`, `packages/shared`.
- SQLite WAL, migrations, job/session/event repositories, FTS tables.
- Read-only NAS tools with root-relative path safety and symlink escape checks.
- Fastify API, SSE event stream, worker job processor, React file browser/chat/timeline.

## Phase 2 - Approval-based Mutations

- Agent turns create `pending_approvals`; the worker does not mutate files directly.
- API approval/rejection endpoints execute approved proposals and keep rejected proposals read-only.
- Mutation tools cover `mkdir`, `move`, `copy`, `rename`, `tag`, `trash`, and `restore`.
- Reversible applied operations can be rolled back through `/api/operations/:id/rollback`.
- UI exposes approvals, operation history, rollback controls, and SSE `approval.pending` refresh.

## Phase 3 - Indexing

- `apps/indexer` scans configured NAS roots without following symlinks, hashes changed files, extracts bounded text, and writes `indexed_files` and `indexed_text`.
- Incremental scans skip unchanged size/mtime pairs, preserve the last successful record on file errors, and suppress stale cleanup after incomplete traversal.
- Latest per-root run status and root-relative failures are persisted and exposed through `GET /api/indexer/status`.
- Search prefers directory-scoped SQLite FTS with indexed metadata and falls back to directory-scoped filename search.
- Duplicate detection uses indexed hashes for scheduler reports.
- The systemd timer provides 30-minute eventual consistency; OCR, PDF/Office extraction, watchers, and mutation-triggered refresh are deferred.

## Phase 4 - Native Packaging

- `packaging/systemd` contains API, worker, indexer, scheduler, and maintenance units/timers with hardening defaults.
- `packaging/etc/config.toml` and `config.example.toml` define appliance config.
- `packaging/scripts/sigmaos-first-boot.sh` initializes admin display name, NAS root, model provider config, data directories, and local admin row.
- `packaging/debian` contains Debian package metadata and install paths for `/usr/lib/sigmaos`, `/etc/sigmaos`, and `/var/lib/sigmaos`.

## Phase 5 - Appliance Evolution

- `apps/scheduler` generates duplicate, backup-check, model-provider, and health reports.
- Maintenance performs SQLite WAL checkpoint/optimize and reports trash state without permanent deletion.
- Local model provider config is parsed and reported as a reserved adapter path.
- `packaging/appliance` contains rootfs manifest and image build script for Node, Pi, SQLite, systemd, OCR/media helpers, and NAS health tooling.

## Verification

- `npm run typecheck`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm audit --omit=dev`
- `npm run index`
- `npm run schedule`
- `npm run maintenance`
- `sh -n` for packaging shell scripts and Debian maintainer scripts
- Browser snapshots and screenshots at desktop and mobile widths via `agent-browser`

`systemd-analyze verify`, `dpkg-buildpackage`, `mmdebstrap`, and `systemd-nspawn` were not available in the local macOS workspace, so Debian package and appliance image artifacts were not built on this host.
