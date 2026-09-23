use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use nix::unistd::{Gid, Uid, chown};
use toml_edit::{DocumentMut, Item, Table, value};
use uuid::Uuid;

use crate::error::HostdError;

const BACKUP_SUFFIX: &str = ".pre-hostd.bak";

#[derive(Debug, PartialEq, Eq)]
pub struct ConfigMigrationOutcome {
    pub changed: bool,
    pub backup_path: Option<PathBuf>,
}

pub fn migrate_config(path: &Path) -> Result<ConfigMigrationOutcome, HostdError> {
    let original = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ConfigMigrationOutcome {
                changed: false,
                backup_path: None,
            });
        }
        Err(error) => return Err(error.into()),
    };
    let text = std::str::from_utf8(&original)
        .map_err(|_| HostdError::validation("SigmaOS configuration is not UTF-8"))?;
    let mut document = text
        .parse::<DocumentMut>()
        .map_err(|_| HostdError::validation("SigmaOS configuration is invalid TOML"))?;

    let legacy_socket_path = document
        .get("shares")
        .and_then(Item::as_table)
        .and_then(|shares| shares.get("helper_socket_path"))
        .and_then(Item::as_str)
        .map(str::to_owned);
    if legacy_socket_path.is_none() {
        return Ok(ConfigMigrationOutcome {
            changed: false,
            backup_path: None,
        });
    }

    let hostd_has_socket_path = document
        .get("hostd")
        .and_then(Item::as_table)
        .and_then(|hostd| hostd.get("socket_path"))
        .is_some();
    if !hostd_has_socket_path {
        if !document.contains_key("hostd") {
            document.insert("hostd", Item::Table(Table::new()));
        }
        let hostd = document
            .get_mut("hostd")
            .and_then(Item::as_table_mut)
            .ok_or_else(|| HostdError::validation("[hostd] must be a TOML table"))?;
        hostd.insert(
            "socket_path",
            value(legacy_socket_path.expect("legacy socket path is present")),
        );
    }
    let shares = document
        .get_mut("shares")
        .and_then(Item::as_table_mut)
        .ok_or_else(|| HostdError::validation("[shares] must be a TOML table"))?;
    shares.remove("helper_socket_path");

    let metadata = fs::metadata(path)?;
    let backup_path = backup_path(path);
    create_backup(&backup_path, &original)?;
    replace_atomically(path, document.to_string().as_bytes(), &metadata)?;
    Ok(ConfigMigrationOutcome {
        changed: true,
        backup_path: Some(backup_path),
    })
}

fn backup_path(path: &Path) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(BACKUP_SUFFIX);
    PathBuf::from(value)
}

fn create_backup(path: &Path, content: &[u8]) -> Result<(), HostdError> {
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
        sync_parent(path)?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn replace_atomically(
    path: &Path,
    content: &[u8],
    metadata: &fs::Metadata,
) -> Result<(), HostdError> {
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(metadata.permissions().mode() & 0o777)
            .open(&temporary)?;
        file.write_all(content)?;
        chown(
            &temporary,
            Some(Uid::from_raw(metadata.uid())),
            Some(Gid::from_raw(metadata.gid())),
        )
        .map_err(|error| HostdError::unavailable(error.to_string()))?;
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
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.toml");
    path.with_file_name(format!(".{file_name}.{}", Uuid::new_v4()))
}

fn sync_parent(path: &Path) -> Result<(), HostdError> {
    let parent = path
        .parent()
        .ok_or_else(|| HostdError::validation("configuration path has no parent directory"))?;
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn migrates_the_legacy_socket_and_preserves_surrounding_content() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            "# appliance\n[shares]\nenabled = true\nhelper_socket_path = \"/tmp/legacy.sock\" # old\n",
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let original_metadata = fs::metadata(&path).unwrap();

        let outcome = migrate_config(&path).unwrap();
        let migrated = fs::read_to_string(&path).unwrap();

        assert!(outcome.changed);
        assert!(migrated.contains("# appliance"));
        assert!(migrated.contains("enabled = true"));
        assert!(!migrated.contains("helper_socket_path"));
        assert!(migrated.contains("[hostd]\n"));
        assert!(migrated.contains("socket_path = \"/tmp/legacy.sock\""));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        let migrated_metadata = fs::metadata(&path).unwrap();
        assert_eq!(migrated_metadata.uid(), original_metadata.uid());
        assert_eq!(migrated_metadata.gid(), original_metadata.gid());

        let backup = outcome.backup_path.unwrap();
        assert_eq!(
            fs::read_to_string(&backup).unwrap(),
            "# appliance\n[shares]\nenabled = true\nhelper_socket_path = \"/tmp/legacy.sock\" # old\n"
        );
        assert_eq!(
            fs::metadata(backup).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn keeps_an_explicit_hostd_value_when_both_keys_exist() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            "[shares]\nhelper_socket_path = \"/tmp/legacy.sock\"\n\n[hostd]\nsocket_path = \"/tmp/current.sock\"\n",
        )
        .unwrap();

        migrate_config(&path).unwrap();
        let migrated = fs::read_to_string(path).unwrap();
        assert!(!migrated.contains("helper_socket_path"));
        assert!(migrated.contains("socket_path = \"/tmp/current.sock\""));
        assert!(!migrated.contains("/tmp/legacy.sock"));
    }

    #[test]
    fn is_idempotent_and_does_not_replace_the_backup() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            "[shares]\nhelper_socket_path = \"/tmp/legacy.sock\"\n",
        )
        .unwrap();

        let first = migrate_config(&path).unwrap();
        let backup = first.backup_path.unwrap();
        fs::write(&backup, "sentinel").unwrap();
        let second = migrate_config(&path).unwrap();

        assert_eq!(
            second,
            ConfigMigrationOutcome {
                changed: false,
                backup_path: None
            }
        );
        assert_eq!(fs::read_to_string(backup).unwrap(), "sentinel");
    }
}
