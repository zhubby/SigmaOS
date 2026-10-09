import type { Migration } from "./types.js";

export const productionMigrations: Migration[] = [
  {
    id: "009_p0_operations",
    sql: `
      ALTER TABLE nas_roots ADD COLUMN mount_policy TEXT NOT NULL DEFAULT 'optional'
        CHECK (mount_policy IN ('required', 'optional'));
      ALTER TABLE nas_roots ADD COLUMN expected_source TEXT;
      ALTER TABLE nas_roots ADD COLUMN expected_uuid TEXT;
      ALTER TABLE nas_roots ADD COLUMN expected_fstype TEXT;

      ALTER TABLE index_runs ADD COLUMN duration_ms INTEGER;
      ALTER TABLE index_runs ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE index_runs ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE index_runs ADD COLUMN text_file_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE index_runs ADD COLUMN phase TEXT;
      ALTER TABLE index_runs ADD COLUMN current_path TEXT;
      ALTER TABLE index_runs ADD COLUMN last_progress_at TEXT;

      CREATE TABLE IF NOT EXISTS nas_root_readiness (
        root_id TEXT PRIMARY KEY REFERENCES nas_roots(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('ready', 'not_ready', 'unknown', 'config_invalid')),
        checked_at TEXT NOT NULL,
        reason TEXT,
        source TEXT,
        uuid TEXT,
        fstype TEXT
      );

      CREATE TABLE IF NOT EXISTS backup_runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly', 'check', 'restore')),
        status TEXT NOT NULL CHECK (status IN ('validating', 'running', 'completed', 'failed', 'interrupted')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        snapshot_ids_json TEXT NOT NULL DEFAULT '[]',
        files INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        verified INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS backup_failures (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES backup_runs(id) ON DELETE CASCADE,
        root_id TEXT REFERENCES nas_roots(id) ON DELETE CASCADE,
        path TEXT,
        code TEXT,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_backup_runs_started_at ON backup_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_backup_failures_run_id ON backup_failures(run_id);
      CREATE TRIGGER IF NOT EXISTS trg_backup_failures_root_matches_run
      BEFORE INSERT ON backup_failures
      WHEN NEW.root_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM nas_root_readiness WHERE root_id = NEW.root_id
      ) AND NOT EXISTS (
        SELECT 1 FROM nas_roots WHERE id = NEW.root_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'backup failure root does not exist');
      END;

      CREATE TABLE IF NOT EXISTS health_alerts (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        scope TEXT NOT NULL,
        root_id TEXT REFERENCES nas_roots(id) ON DELETE CASCADE,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
        status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        resolved_at TEXT,
        details TEXT,
        UNIQUE(code, scope)
      );
      CREATE INDEX IF NOT EXISTS idx_health_alerts_status_last_seen ON health_alerts(status, last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS execution_locks (
        name TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL
      );
    `
  },
  {
    id: "010_index_run_history_archive",
    sql: `
      CREATE TABLE IF NOT EXISTS index_run_history (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        scanned INTEGER NOT NULL DEFAULT 0,
        indexed INTEGER NOT NULL DEFAULT 0,
        unchanged INTEGER NOT NULL DEFAULT 0,
        removed INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        duration_ms INTEGER,
        bytes INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 0,
        text_file_count INTEGER NOT NULL DEFAULT 0,
        phase TEXT,
        current_path TEXT,
        last_progress_at TEXT,
        failures_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_index_run_history_root_started_at ON index_run_history(root_id, started_at DESC);
    `
  },
  {
    id: "011_storage_pool_delete",
    disableForeignKeys: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE storage_operations RENAME TO storage_operations_old;

      CREATE TABLE storage_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN ('create_pool', 'delete_pool')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'applied', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO storage_operations (id, approval_id, action, target_id, status, metadata_json, created_at, updated_at)
      SELECT id, approval_id, action, target_id, status, metadata_json, created_at, updated_at
      FROM storage_operations_old;

      DROP TABLE storage_operations_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX IF NOT EXISTS idx_storage_operations_created_at
        ON storage_operations(created_at);
    `
  },
  {
    id: "012_docker_resource_create",
    disableForeignKeys: true,
    sql: `
      PRAGMA legacy_alter_table = ON;

      ALTER TABLE docker_operations RENAME TO docker_operations_old;

      CREATE TABLE docker_operations (
        id TEXT PRIMARY KEY,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK (action IN ('create', 'start', 'stop', 'restart', 'remove', 'compose_up', 'compose_down', 'compose_pull', 'compose_restart', 'console')),
        target_type TEXT NOT NULL CHECK (target_type IN ('container', 'compose_project', 'console', 'volume', 'network')),
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'applied', 'failed')),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO docker_operations (
        id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
      )
      SELECT id, approval_id, action, target_type, target_id, status, metadata_json, created_at, updated_at
      FROM docker_operations_old;

      DROP TABLE docker_operations_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX IF NOT EXISTS idx_docker_operations_created_at
        ON docker_operations(created_at);
    `
  },
  {
    id: "013_download_tasks",
    sql: `
      CREATE TABLE IF NOT EXISTS download_tasks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE RESTRICT,
        storage_pool_id TEXT NOT NULL,
        target_directory TEXT NOT NULL,
        target_file_name TEXT NOT NULL,
        target_path TEXT NOT NULL,
        partial_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
        received_bytes INTEGER NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
        total_bytes INTEGER CHECK (total_bytes IS NULL OR total_bytes >= 0),
        speed_bytes_per_second INTEGER NOT NULL DEFAULT 0 CHECK (speed_bytes_per_second >= 0),
        etag TEXT,
        last_modified TEXT,
        error TEXT,
        worker_id TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        last_progress_at TEXT,
        file_operation_id TEXT REFERENCES file_operations(id) ON DELETE SET NULL,
        UNIQUE(root_id, storage_pool_id, target_path)
      );

      CREATE INDEX IF NOT EXISTS idx_download_tasks_status_created_at
        ON download_tasks(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_download_tasks_updated_at
        ON download_tasks(updated_at DESC);
    `
  },
  {
    id: "014_operation_notifications",
    sql: `
      CREATE TABLE IF NOT EXISTS operation_notifications (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'docker', 'vm', 'storage', 'share')),
        status TEXT NOT NULL CHECK (status IN ('pending_approval', 'running', 'succeeded', 'failed', 'rejected', 'cancelled')),
        summary TEXT NOT NULL,
        error TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_operation_notifications_updated_at
        ON operation_notifications(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_operation_notifications_unread_updated_at
        ON operation_notifications(read_at, updated_at DESC);
    `
  },
  {
    id: "015_terminal_tabs",
    sql: `
      CREATE TABLE IF NOT EXISTS terminal_tabs (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal > 0),
        custom_title TEXT CHECK (
          custom_title IS NULL OR (length(custom_title) BETWEEN 1 AND 64 AND custom_title = trim(custom_title))
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(root_id, ordinal)
      );

      CREATE INDEX IF NOT EXISTS idx_terminal_tabs_root_ordinal
        ON terminal_tabs(root_id, ordinal);

      CREATE TABLE IF NOT EXISTS terminal_tab_sets (
        root_id TEXT PRIMARY KEY REFERENCES nas_roots(id) ON DELETE CASCADE,
        active_tab_id TEXT,
        next_ordinal INTEGER NOT NULL DEFAULT 1 CHECK (next_ordinal > 0),
        initialized_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TRIGGER IF NOT EXISTS trg_terminal_tab_sets_active_insert
      BEFORE INSERT ON terminal_tab_sets
      WHEN NEW.active_tab_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM terminal_tabs
        WHERE id = NEW.active_tab_id AND root_id = NEW.root_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'active terminal tab must belong to root');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_terminal_tab_sets_active_update
      BEFORE UPDATE OF active_tab_id, root_id ON terminal_tab_sets
      WHEN NEW.active_tab_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM terminal_tabs
        WHERE id = NEW.active_tab_id AND root_id = NEW.root_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'active terminal tab must belong to root');
      END;
    `
  },
  {
    id: "016_hostd_config",
    sql: `
      UPDATE system_settings
      SET value_json = json_remove(value_json, '$.helperSocketPath')
      WHERE key = 'share_settings'
        AND json_valid(value_json)
        AND json_type(value_json, '$.helperSocketPath') IS NOT NULL;
    `
  },
  {
    id: "017_photo_library",
    sql: `
      CREATE TABLE IF NOT EXISTS photo_assets (
        id TEXT PRIMARY KEY,
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        storage_pool_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        mtime_ms INTEGER NOT NULL CHECK (mtime_ms >= 0),
        content_hash TEXT,
        width INTEGER CHECK (width IS NULL OR width > 0),
        height INTEGER CHECK (height IS NULL OR height > 0),
        orientation INTEGER,
        taken_at TEXT NOT NULL,
        taken_at_source TEXT NOT NULL CHECK (taken_at_source IN ('exif', 'file_mtime')),
        thumbnail_key TEXT,
        preview_key TEXT,
        status TEXT NOT NULL CHECK (status IN ('ready', 'failed')),
        error TEXT,
        library_updated_at TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        UNIQUE(root_id, storage_pool_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_photo_assets_timeline
        ON photo_assets(library_updated_at, status, taken_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_photo_assets_content_hash
        ON photo_assets(library_updated_at, content_hash)
        WHERE content_hash IS NOT NULL;

      CREATE TABLE IF NOT EXISTS photo_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('full_scan', 'path_refresh')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        root_id TEXT NOT NULL REFERENCES nas_roots(id) ON DELETE CASCADE,
        storage_pool_id TEXT NOT NULL,
        path TEXT NOT NULL,
        library_updated_at TEXT NOT NULL,
        scanned INTEGER NOT NULL DEFAULT 0 CHECK (scanned >= 0),
        processed INTEGER NOT NULL DEFAULT 0 CHECK (processed >= 0),
        failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
        current_path TEXT,
        error TEXT,
        worker_id TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_photo_jobs_status_created_at
        ON photo_jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_photo_jobs_library_created_at
        ON photo_jobs(library_updated_at, created_at DESC);
    `
  },
  {
    id: "018_photo_upload_reservations",
    sql: `
      CREATE TABLE IF NOT EXISTS photo_upload_reservations (
        id TEXT PRIMARY KEY,
        library_updated_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(library_updated_at, content_hash),
        UNIQUE(library_updated_at, path)
      );

      CREATE INDEX IF NOT EXISTS idx_photo_upload_reservations_created_at
        ON photo_upload_reservations(library_updated_at, created_at);
    `
  },
  {
    id: "019_photo_metadata_index",
    sql: `
      CREATE TABLE IF NOT EXISTS photo_asset_metadata (
        asset_id TEXT PRIMARY KEY REFERENCES photo_assets(id) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL CHECK (schema_version > 0),
        status TEXT NOT NULL CHECK (status IN ('ready', 'partial')),
        media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'raw')),
        captured_at TEXT,
        captured_at_local TEXT,
        capture_offset_minutes INTEGER,
        capture_source TEXT NOT NULL CHECK (
          capture_source IN ('sidecar_xmp', 'embedded_xmp', 'iptc', 'exif', 'video', 'file_mtime')
        ),
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        container TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        camera_make TEXT,
        camera_model TEXT,
        software TEXT,
        body_serial TEXT,
        lens_make TEXT,
        lens_model TEXT,
        lens_serial TEXT,
        iso REAL CHECK (iso IS NULL OR iso >= 0),
        exposure_time_seconds REAL CHECK (exposure_time_seconds IS NULL OR exposure_time_seconds >= 0),
        aperture REAL CHECK (aperture IS NULL OR aperture >= 0),
        focal_length_mm REAL CHECK (focal_length_mm IS NULL OR focal_length_mm >= 0),
        focal_length_35_mm REAL CHECK (focal_length_35_mm IS NULL OR focal_length_35_mm >= 0),
        exposure_bias_ev REAL,
        exposure_program TEXT,
        metering_mode TEXT,
        flash TEXT,
        white_balance TEXT,
        title TEXT,
        description TEXT,
        creator TEXT,
        copyright TEXT,
        rating REAL,
        gps_latitude REAL CHECK (gps_latitude IS NULL OR (gps_latitude >= -90 AND gps_latitude <= 90)),
        gps_longitude REAL CHECK (gps_longitude IS NULL OR (gps_longitude >= -180 AND gps_longitude <= 180)),
        gps_altitude_m REAL,
        gps_direction_deg REAL,
        raw_metadata_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        sidecar_path TEXT,
        sidecar_size_bytes INTEGER CHECK (sidecar_size_bytes IS NULL OR sidecar_size_bytes >= 0),
        sidecar_mtime_ms INTEGER CHECK (sidecar_mtime_ms IS NULL OR sidecar_mtime_ms >= 0),
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_photo_asset_metadata_version
        ON photo_asset_metadata(schema_version, status);
      CREATE INDEX IF NOT EXISTS idx_photo_asset_metadata_camera
        ON photo_asset_metadata(camera_model, asset_id);
      CREATE INDEX IF NOT EXISTS idx_photo_asset_metadata_lens
        ON photo_asset_metadata(lens_model, asset_id);
      CREATE INDEX IF NOT EXISTS idx_photo_asset_metadata_capture
        ON photo_asset_metadata(captured_at, asset_id);
      CREATE INDEX IF NOT EXISTS idx_photo_asset_metadata_rating
        ON photo_asset_metadata(rating, asset_id);

      CREATE TABLE IF NOT EXISTS photo_keywords (
        asset_id TEXT NOT NULL REFERENCES photo_assets(id) ON DELETE CASCADE,
        keyword TEXT NOT NULL,
        normalized_keyword TEXT NOT NULL,
        PRIMARY KEY(asset_id, normalized_keyword)
      );

      CREATE INDEX IF NOT EXISTS idx_photo_keywords_value
        ON photo_keywords(normalized_keyword, asset_id);

      CREATE TABLE IF NOT EXISTS photo_metadata_values (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id TEXT NOT NULL REFERENCES photo_assets(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        key TEXT NOT NULL,
        value_type TEXT NOT NULL CHECK (value_type IN ('text', 'number', 'date', 'boolean')),
        text_value TEXT,
        normalized_text_value TEXT,
        number_value REAL,
        date_value TEXT,
        boolean_value INTEGER CHECK (boolean_value IS NULL OR boolean_value IN (0, 1)),
        sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_photo_metadata_values_key_type
        ON photo_metadata_values(key, value_type, asset_id);
      CREATE INDEX IF NOT EXISTS idx_photo_metadata_values_text
        ON photo_metadata_values(key, normalized_text_value, asset_id)
        WHERE normalized_text_value IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_photo_metadata_values_number
        ON photo_metadata_values(key, number_value, asset_id)
        WHERE number_value IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_photo_metadata_values_date
        ON photo_metadata_values(key, date_value, asset_id)
        WHERE date_value IS NOT NULL;

      CREATE VIRTUAL TABLE IF NOT EXISTS photo_metadata_fts USING fts5(
        asset_id UNINDEXED,
        name,
        path,
        title,
        description,
        creator,
        copyright,
        keywords,
        camera,
        lens,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS photo_geo_index USING rtree(
        metadata_rowid,
        min_latitude,
        max_latitude,
        min_longitude,
        max_longitude
      );

      CREATE TRIGGER IF NOT EXISTS trg_photo_asset_metadata_delete_indexes
      BEFORE DELETE ON photo_asset_metadata
      BEGIN
        DELETE FROM photo_geo_index WHERE metadata_rowid = OLD.rowid;
        DELETE FROM photo_metadata_fts WHERE asset_id = OLD.asset_id;
      END;
    `
  },
  {
    id: "020_docker_compose_apps",
    sql: `
      CREATE TABLE IF NOT EXISTS docker_apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_key TEXT NOT NULL UNIQUE COLLATE NOCASE,
        compose_content TEXT NOT NULL,
        services_json TEXT NOT NULL DEFAULT '[]',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        risk TEXT NOT NULL CHECK (risk IN ('medium', 'high')),
        revision TEXT NOT NULL,
        deployed_revision TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS docker_app_environment (
        app_id TEXT NOT NULL REFERENCES docker_apps(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (app_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_docker_apps_updated_at
        ON docker_apps(updated_at DESC);
    `
  },
  {
    id: "021_vm_direct_actions",
    disableForeignKeys: true,
    sql: `
      UPDATE vm_operations
      SET status = 'failed',
          metadata_json = json_set(
            metadata_json,
            '$.error',
            'VM approval retired because VM actions now execute directly',
            '$.failedAt',
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status IN ('proposed', 'approved')
        AND approval_id IN (
          SELECT id FROM pending_approvals
          WHERE kind = 'vm_operation' AND status IN ('pending', 'approved')
        );

      UPDATE jobs
      SET status = 'cancelled',
          error = 'VM approval retired because VM actions now execute directly',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status = 'waiting_approval'
        AND id IN (
          SELECT job_id FROM pending_approvals
          WHERE kind = 'vm_operation' AND status IN ('pending', 'approved')
        );

      UPDATE operation_notifications
      SET status = 'cancelled',
          error = 'VM approval retired because VM actions now execute directly',
          read_at = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE job_id IN (
        SELECT job_id FROM pending_approvals
        WHERE kind = 'vm_operation' AND status IN ('pending', 'approved')
      );

      UPDATE pending_approvals
      SET status = 'expired',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE kind = 'vm_operation' AND status IN ('pending', 'approved');

      PRAGMA legacy_alter_table = ON;

      ALTER TABLE vm_console_authorizations RENAME TO vm_console_authorizations_old;

      CREATE TABLE vm_console_authorizations (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES vm_operations(id) ON DELETE CASCADE,
        approval_id TEXT REFERENCES pending_approvals(id) ON DELETE CASCADE,
        domain_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'used', 'expired', 'failed')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );

      INSERT INTO vm_console_authorizations
        (id, operation_id, approval_id, domain_name, status, created_at, expires_at, used_at)
      SELECT id, operation_id, approval_id, domain_name, status, created_at, expires_at, used_at
      FROM vm_console_authorizations_old;

      DROP TABLE vm_console_authorizations_old;

      PRAGMA legacy_alter_table = OFF;

      CREATE INDEX idx_vm_console_authorizations_status_expires_at
        ON vm_console_authorizations(status, expires_at);
    `
  }
];
