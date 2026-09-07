import type { NasRootConfig, NasRootRecord } from "@sigmaos/shared";
import type { SigmaDatabase } from "../connection.js";
import { mapNasRoot } from "./operation-mappers.js";
import type { DbNasRootRow } from "./repository-rows.js";

export function ensureNasRoots(db: SigmaDatabase, roots: NasRootConfig[]): void {
  const now = new Date().toISOString();
  const existingRoot = db.prepare(
    "SELECT path, mount_policy, expected_source, expected_uuid, expected_fstype FROM nas_roots WHERE id = ?"
  );
  const clearReadiness = db.prepare("DELETE FROM nas_root_readiness WHERE root_id = ?");
  const upsert = db.prepare(`
    INSERT INTO nas_roots (id, name, path, enabled, mount_policy, expected_source, expected_uuid, expected_fstype, created_at, updated_at)
    VALUES (@id, @name, @path, 1, @mountPolicy, @expectedSource, @expectedUuid, @expectedFstype, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      enabled = 1,
      mount_policy = excluded.mount_policy,
      expected_source = excluded.expected_source,
      expected_uuid = excluded.expected_uuid,
      expected_fstype = excluded.expected_fstype,
      updated_at = excluded.updated_at
  `);
  const disableMissing = db.prepare(`
    UPDATE nas_roots
    SET enabled = 0, updated_at = ?
    WHERE id NOT IN (${roots.map(() => "?").join(",") || "NULL"})
  `);

  const tx = db.transaction((items: NasRootConfig[]) => {
    for (const root of items) {
      const previous = existingRoot.get(root.id) as {
        path: string;
        mount_policy: string;
        expected_source: string | null;
        expected_uuid: string | null;
        expected_fstype: string | null;
      } | undefined;
      const nextMountPolicy = root.mountPolicy ?? "optional";
      const nextExpectedSource = root.expectedSource ?? null;
      const nextExpectedUuid = root.expectedUuid ?? null;
      const nextExpectedFstype = root.expectedFstype ?? null;
      if (
        previous &&
        (previous.path !== root.path ||
          previous.mount_policy !== nextMountPolicy ||
          previous.expected_source !== nextExpectedSource ||
          previous.expected_uuid !== nextExpectedUuid ||
          previous.expected_fstype !== nextExpectedFstype)
      ) {
        clearReadiness.run(root.id);
      }
      upsert.run({
        id: root.id,
        name: root.name,
        path: root.path,
        mountPolicy: nextMountPolicy,
        expectedSource: nextExpectedSource,
        expectedUuid: nextExpectedUuid,
        expectedFstype: nextExpectedFstype,
        createdAt: now,
        updatedAt: now
      });
    }
    disableMissing.run(now, ...items.map((root) => root.id));
  });

  tx(roots);
}

export function listNasRoots(db: SigmaDatabase): NasRootRecord[] {
    const rows = db
    .prepare("SELECT id, name, path, enabled, mount_policy, expected_source, expected_uuid, expected_fstype, created_at, updated_at FROM nas_roots WHERE enabled = 1 ORDER BY name")
    .all() as DbNasRootRow[];
  return rows.map(mapNasRoot);
}

export function getNasRoot(db: SigmaDatabase, rootId: string): NasRootRecord | null {
  const row = db
    .prepare("SELECT id, name, path, enabled, mount_policy, expected_source, expected_uuid, expected_fstype, created_at, updated_at FROM nas_roots WHERE id = ? AND enabled = 1")
    .get(rootId) as DbNasRootRow | undefined;
  return row ? mapNasRoot(row) : null;
}
