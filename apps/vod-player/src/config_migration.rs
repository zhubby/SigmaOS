use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use nix::unistd::{Gid, Uid, chown};
use toml_edit::{DocumentMut, Item, Table, value};
use uuid::Uuid;

use crate::config::{DEFAULT_SOCKET_PATH, DEFAULT_STATE_PATH};
use crate::error::{ErrorCode, VodError};

const LEGACY_SOCKET_PATH: &str = "/run/sigmaos/player-helper.sock";
const BACKUP_SUFFIX: &str = ".pre-vod-player.bak";

#[derive(Debug, PartialEq, Eq)]
pub struct MigrationOutcome {
    pub changed: bool,
    pub backup_path: Option<PathBuf>,
}

pub fn migrate_config(path: &Path) -> Result<MigrationOutcome, VodError> {
    let original = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(MigrationOutcome {
                changed: false,
                backup_path: None,
            });
        }
        Err(error) => return Err(error.into()),
    };
    let text = std::str::from_utf8(&original).map_err(|_| {
        VodError::new(
            ErrorCode::InvalidCommand,
            "SigmaOS configuration is not UTF-8",
            400,
        )
    })?;
    let mut document = text.parse::<DocumentMut>().map_err(|_| {
        VodError::new(
            ErrorCode::InvalidCommand,
            "SigmaOS configuration is invalid TOML",
            400,
        )
    })?;
    let legacy = document.get("player").cloned();
    let current = document.get("vod_player").cloned();
    if legacy.is_none() && current.is_none() {
        return Ok(MigrationOutcome {
            changed: false,
            backup_path: None,
        });
    }

    let mut migrated = match legacy.as_ref() {
        Some(item) => migrate_legacy_table(item)?,
        None => current
            .as_ref()
            .and_then(Item::as_table)
            .cloned()
            .ok_or_else(|| {
                VodError::new(
                    ErrorCode::InvalidCommand,
                    "[vod_player] must be a TOML table",
                    400,
                )
            })?,
    };
    add_reliability_defaults(&mut migrated);
    let mut current_changed = false;
    if let Some(current) = current.as_ref() {
        let current = current.as_table().ok_or_else(|| {
            VodError::new(
                ErrorCode::InvalidCommand,
                "[vod_player] must be a TOML table",
                400,
            )
        })?;
        let mut normalized = current.clone();
        add_reliability_defaults(&mut normalized);
        current_changed = !tables_equal(current, &normalized)?;
        if legacy.is_some() && !tables_equal(&normalized, &migrated)? {
            return Err(VodError::new(
                ErrorCode::InvalidCommand,
                "[player] and [vod_player] conflict; refusing to overwrite configuration",
                409,
            ));
        }
        migrated = normalized;
    }

    let replacement = Item::Table(migrated);
    let unchanged = legacy.is_none() && !current_changed;
    if unchanged {
        return Ok(MigrationOutcome {
            changed: false,
            backup_path: None,
        });
    }
    document.remove("player");
    document.insert("vod_player", replacement);
    let metadata = fs::metadata(path)?;
    let backup_path = PathBuf::from(format!("{}{}", path.display(), BACKUP_SUFFIX));
    create_backup(&backup_path, &original)?;
    replace_atomically(path, document.to_string().as_bytes(), &metadata)?;
    Ok(MigrationOutcome {
        changed: true,
        backup_path: Some(backup_path),
    })
}

fn migrate_legacy_table(item: &Item) -> Result<Table, VodError> {
    let mut table = item.as_table().cloned().ok_or_else(|| {
        VodError::new(
            ErrorCode::InvalidCommand,
            "[player] must be a TOML table",
            400,
        )
    })?;
    if let Some(socket) = table.remove("helper_socket_path") {
        let socket = socket.as_str().ok_or_else(|| {
            VodError::new(
                ErrorCode::InvalidCommand,
                "[player].helper_socket_path must be a string",
                400,
            )
        })?;
        table.insert(
            "socket_path",
            value(if socket == LEGACY_SOCKET_PATH {
                DEFAULT_SOCKET_PATH
            } else {
                socket
            }),
        );
    } else if !table.contains_key("socket_path") {
        table.insert("socket_path", value(DEFAULT_SOCKET_PATH));
    }
    Ok(table)
}

fn add_reliability_defaults(table: &mut Table) {
    insert_default(table, "socket_path", value(DEFAULT_SOCKET_PATH));
    insert_default(table, "state_path", value(DEFAULT_STATE_PATH));
    insert_default(table, "command_timeout_ms", value(5_000));
    insert_default(table, "startup_timeout_ms", value(15_000));
    insert_default(table, "checkpoint_interval_ms", value(5_000));
    insert_default(table, "retry_base_delay_ms", value(2_000));
    insert_default(table, "retry_max_delay_ms", value(60_000));
}

fn insert_default(table: &mut Table, key: &str, item: Item) {
    if !table.contains_key(key) {
        table.insert(key, item);
    }
}

fn tables_equal(left: &Table, right: &Table) -> Result<bool, VodError> {
    fn value(table: &Table) -> Result<serde_json::Value, VodError> {
        toml_edit::de::from_str::<serde_json::Value>(&format!("[value]\n{table}")).map_err(
            |error| {
                VodError::internal(format!(
                    "Unable to compare VOD player configuration: {error}"
                ))
            },
        )
    }
    Ok(value(left)? == value(right)?)
}

fn create_backup(path: &Path, content: &[u8]) -> Result<(), VodError> {
    if path.exists() {
        return Ok(());
    }
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
        match fs::hard_link(&temporary, path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
        sync_parent(path)
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn replace_atomically(
    path: &Path,
    content: &[u8],
    metadata: &fs::Metadata,
) -> Result<(), VodError> {
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
        chown(
            &temporary,
            Some(Uid::from_raw(metadata.uid())),
            Some(Gid::from_raw(metadata.gid())),
        )?;
        fs::set_permissions(&temporary, metadata.permissions())?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        sync_parent(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn temporary_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.toml");
    path.with_file_name(format!(".{name}.{}", Uuid::new_v4().simple()))
}

fn sync_parent(path: &Path) -> Result<(), VodError> {
    let parent = path
        .parent()
        .ok_or_else(|| VodError::internal("Configuration path has no parent"))?;
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_config_atomically_and_idempotently() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            "[player]\nenabled = true\nhelper_socket_path = '/run/sigmaos/player-helper.sock'\n",
        )
        .unwrap();
        let result = migrate_config(&path).unwrap();
        assert!(result.changed);
        let migrated = fs::read_to_string(&path).unwrap();
        assert!(migrated.contains("[vod_player]"));
        assert!(migrated.contains(DEFAULT_SOCKET_PATH));
        assert!(!migrated.contains("[player]"));
        assert!(!migrate_config(&path).unwrap().changed);
        assert_eq!(
            fs::read_to_string(result.backup_path.unwrap()).unwrap(),
            "[player]\nenabled = true\nhelper_socket_path = '/run/sigmaos/player-helper.sock'\n"
        );
    }

    #[test]
    fn refuses_conflicting_old_and_new_tables() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            "[player]\nenabled = true\n[vod_player]\nenabled = false\n",
        )
        .unwrap();
        assert_eq!(migrate_config(&path).unwrap_err().status_code, 409);
    }

    #[test]
    fn preserves_a_custom_legacy_socket_path() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            "[player]\nenabled = true\nhelper_socket_path = '/run/sigmaos/custom-vod.sock'\n",
        )
        .unwrap();
        migrate_config(&path).unwrap();
        let migrated = fs::read_to_string(&path).unwrap();
        assert!(migrated.contains("socket_path"));
        assert!(migrated.contains("/run/sigmaos/custom-vod.sock"));
    }
}
