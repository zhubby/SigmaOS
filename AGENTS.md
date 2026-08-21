# Agent Instructions

These instructions apply to the whole repository.

## Project

SigmaOS is a TypeScript monorepo for a personal Linux NAS appliance. It includes a React/Vite web UI, Fastify API, worker/indexer/scheduler apps, shared packages, and Debian/systemd packaging assets.

## Repository Layout

- `apps/web`: React + Vite frontend.
- `apps/api`: Fastify HTTP API.
- `apps/worker`: agent worker process.
- `apps/indexer`: filesystem indexer.
- `apps/scheduler`: maintenance and scheduled jobs.
- `packages/db`: SQLite schema and repositories.
- `packages/nas-tools`: path-safe NAS read/write helpers.
- `packages/agent`: agent routing and prompts.
- `packages/shared`: shared config and types.
- `packaging`: Debian, systemd, and appliance packaging.

## Commands

Use the root workspace commands unless a narrower workspace command is clearly enough.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Useful development commands:

```bash
npm run dev
npm run index
npm run schedule
npm run maintenance
```

## Coding Standards

- Keep TypeScript strict and avoid weakening types.
- Prefer existing local patterns over new abstractions.
- Keep changes scoped to the requested behavior.
- Do not commit generated output such as `node_modules`, `dist`, coverage, logs, or `.sigmaos`.
- Keep user-facing UI copy short and operational.
- Use existing dependencies before adding new ones.

## Frontend

- Match the existing dark, dense, utility-focused UI.
- Use `lucide-react` icons for controls and file/type indicators.
- Keep layout stable across desktop and mobile; avoid text overlap.
- For preview/file-browser work, verify with a browser when practical.

## API, Filesystem, And Data Safety

- All filesystem access must stay inside configured NAS roots.
- Preserve traversal and unsafe symlink protections.
- Mutating file operations must remain approval-gated.
- Keep `/api/files/meta` and `/api/files/text` wire shapes stable unless an API change is explicitly requested.
- For SQLite changes, update schema/repository tests and consider migration/backfill safety.

## Testing Expectations

- Add or update focused tests for behavior changes.
- Run `npm run typecheck`, `npm run lint`, and `npm test` before handing off substantive code changes.
- Run `npm run build` when frontend, packaging, or build configuration changes.

## Git

- Do not rewrite history or discard user changes unless explicitly asked.
- Stage specific files rather than broad `git add .` when possible.
- Commit and push only when the user asks.
