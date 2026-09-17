## Code Review Results

**Scope:** base `214af1cea3a2d459c6200966e64da855588966f0` to tracked working tree on main.
**Intent:** Fix CM5 helper ownership churn, image occupancy and unsupported resource controls;
document layered acceptance without changing production workloads or permissions.
**Mode:** autofix, sequential main-thread personas per project tool mapping. No reviewer subagents.

**Reviewers:** correctness, testing, maintainability, project-standards, agent-native,
learnings, security, performance, api-contract, reliability, adversarial,
kieran-typescript, julik-frontend-races.

- Security: root StateDirectory and host resource input checks; unchanged capabilities/write paths.
- Performance: image/container count mapping, linear Map aggregation, no new Engine requests.
- API-contract: additive optional metadata, nullable capability flags, intentional documented 400 validation.
- Reliability: dependency failure/unknown metadata handling and retained daemon recovery path.
- Adversarial: cross-layer changes and large diff; missing metadata, stopped references and capability changes.
- TypeScript: strict optional fields, shared browser-safe export and consumer alignment.
- Frontend-races: polling changes during editing and confirmation, no silently discarded inputs.

### Applied Fixes

| # | File | Issue | Reviewer | Confidence | Route |
|---|------|-------|----------|------------|-------|
| 1 | `apps/web/src/components/workspace/DockerCreateDialogs.tsx:134` | Confirmation disabled on capability change without showing validation | julik-frontend-races | 0.99 | `safe_auto -> review-fixer` |
| 2 | `vitest.config.ts:18` | Browser-safe subpath lacked a Vitest alias before broad shared alias | testing | 1.00 | `safe_auto -> review-fixer` |

- Confirmation now displays validation even before a submission attempt; browser verified the exact warning and disabled command.
- Added the narrow alias before the shared root alias; full tests passed after re-run.
- Supplemental side-effect assertions check no messages/events from rejected create requests.
- Two bounded verification rounds completed. No unresolved actionable code findings.

### Requirements Completeness

- Met: isolated root state declaration with packaging assertions, preserving baseline path.
- Met: ImageID occupancy including stopped containers, conservative unknown removal UI.
- Met: capabilities from Engine through summary, shared checks and disabled/clearable controls.
- Met: tests for false/null/missing/invalid flags, swap dependencies and socket/API chain.
- Met: tracked acceptance, cold state backup, workload data restore and monitoring guidance.
- Remote operational acceptance intentionally deferred under approved scope.

### Learnings & Past Solutions

- No docs/solutions or critical-patterns records exist. No known pattern was available to reuse.
- Engine readiness, resource support, resource telemetry and data recoverability are separate signals.

### Agent-Native Gaps

- Existing NAS agent tools do not directly expose Docker administrative routes. This is a pre-existing
  administrative context gap, not a new core action or authorization to expand tool permissions.
- Resource validation is shared at the API boundary; external API consumers get identical rejection behavior.

### Deployment Notes

- Build/install natively on CM5; inspect merged helper unit/drop-ins and parent/nested ownership.
- Verify both service start orders and helper restart, API/worker database access and restart counts.
- Do not claim live private Registry/Compose, device reboot or workload restore acceptance from mocked tests.
- Preserve matching old package/state backups; database migrations have no general reverse migration.
- Existing backup failures remain separately tracked; production Go requires recovery evidence.

### Coverage

- Standards read: root AGENTS.md and CLAUDE.md; no ancestor-specific files found.
- No independent-reviewer confidence boost: all lenses ran sequentially in the same main thread.
- Formal ce:review excludes unstaged new files per its scope rule: `DockerResourceStatus.tsx`,
  `DockerResourceStatus.test.ts`, `docker-service.test.ts`, `docker-resources.ts`,
  `docker-resources.test.ts`, and todo 002. These source/test files received separate inline inspection
  and are exercised by full typecheck, tests, production build and browser verification.
- No generated output, credential contents, log bodies or screenshots added to Git.
- Residual risks: Linux systemd ownership semantics and resource flags still need deployment acceptance;
  live Registry/Compose paths, reboot and data backup/restore remain unverified on CM5.
- Suppressed findings: 0; failed reviewers: 0 (no subagent dispatch).
- Final gates passed: version 0.3.0 check, typecheck, lint, 80 Vitest files/531 tests plus
  docs content tests, production build, two docs browser smoke tests, desktop/520px checks.
- Temporary browser viewport reset and fixture servers stopped; original localhost:5173 dev server retained.

---

> **Verdict:** Ready with fixes for code integration, not a production-acceptance declaration.
>
> **Reasoning:** Both local findings resolved and reverified; no residual actionable code work.
