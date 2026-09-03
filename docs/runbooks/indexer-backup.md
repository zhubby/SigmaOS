# Indexer and backup runbook

SigmaOS uses a periodic, eventually consistent index. The indexer timer runs every 30 minutes; file changes may take one timer cycle to appear in full-text search.

## First-time backup setup

1. Install `restic` and create a password file readable by the `sigmaos` service.
2. Set `backup.enabled = true`, `backup.repository_path` and `backup.password_file` in `/etc/sigmaos/config.toml`.
3. Run `backup validate`.
4. Run `backup init` explicitly once. Timers never initialize a repository implicitly.
5. Start `sigmaos-backup-daily.timer` and `sigmaos-backup-weekly.timer`.

Restic snapshots are deduplicated snapshots. The weekly tag is a retention/check cadence, not a traditional full-backup mode. Daily retention keeps 7 snapshots and weekly retention keeps 4. A backup run records every snapshot ID and verifies that each snapshot is visible before it can be marked successful; weekly check/prune is skipped after any root or state failure.

## Observability

- `/api/indexer/status` — current index run, counters, progress, metrics and failures.
- `/api/roots/readiness` — mount readiness and expected identity details.
- `/api/backup/status` — backup enablement and recent run summaries. Password contents are never returned.
- `/api/system/health` — aggregate ready/degraded/failed state and active issues.
- `journalctl -u sigmaos-indexer -u sigmaos-backup-daily -u sigmaos-health` — structured service events.

`/health` is a liveness endpoint and remains successful while NAS or backup readiness is degraded.

## Failure recovery

- `mount_not_ready`: verify the root is mounted and source/UUID/FSType match configuration. Index cleanup is skipped until readiness returns.
- `indexer_failed` or `indexer_stalled`: inspect the current path and failure list in the indexer status API, then rerun the indexer after fixing permissions or storage.
- `backup_failed` / `backup_stale`: run `backup validate` and `backup check`; confirm the repository is mounted and writable. Failed runs never prune existing snapshots.
- `repo_check_failed`: repair or replace the repository only after preserving the existing repository for diagnosis.

## Restore drill

Run `backup check`, then restore the state snapshot with `backup restore --snapshot <id>`. Restore first performs a dry-run, then targets a new 0700 staging directory and validates root mappings plus SHA-256 checksums for the SQLite/trash state. P0 never promotes staging automatically and never overwrites active NAS roots, the SigmaOS data directory, or the backup repository.

Failed staging directories are retained for diagnosis and may be removed by maintenance after the configured cleanup window.
