use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use nix::unistd::{Gid, Uid, chown};
use toml_edit::{DocumentMut, Item, Table, value};
use uuid::Uuid;

use crate::config::{DEFAULT_CONFIG_PATH, DEFAULT_SOCKET_PATH};
use crate::error::TermuxError;

const LEGACY_SOCKET_PATH: &str = "/run/sigmaos/terminal-helper.sock";
const BACKUP_SUFFIX: &str = ".pre-termux.bak";

#[derive(Debug, PartialEq, Eq)]
pub struct MigrationOutcome {
    pub changed: bool,
    pub backup_path: Option<PathBuf>,
}

pub fn migrate_config(path: &Path) -> Result<MigrationOutcome, TermuxError> {
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
    let text = std::str::from_utf8(&original)
        .map_err(|_| TermuxError::validation("SigmaOS configuration is not UTF-8"))?;
    let mut document = text
        .parse::<DocumentMut>()
        .map_err(|_| TermuxError::validation("SigmaOS configuration is invalid TOML"))?;
    if !document.contains_key("terminal") {
        document.insert("terminal", Item::Table(Table::new()));
    }
    let terminal = document
        .get_mut("terminal")
        .and_then(Item::as_table_mut)
        .ok_or_else(|| TermuxError::validation("[terminal] must be a TOML table"))?;

    let legacy_socket = terminal
        .get("helper_socket_path")
        .and_then(Item::as_str)
        .map(str::to_owned);
    let has_termux_socket = terminal.get("termux_socket_path").is_some();
    let user_is_sigmaos = terminal.get("user").and_then(Item::as_str) == Some("sigmaos");
    let needs_change = legacy_socket.is_some() || !has_termux_socket || !user_is_sigmaos;
    if !needs_change {
        return Ok(MigrationOutcome {
            changed: false,
            backup_path: None,
        });
    }

    if !has_termux_socket {
        let migrated_socket = match legacy_socket.as_deref() {
            Some(path) if path != LEGACY_SOCKET_PATH => path,
            _ => DEFAULT_SOCKET_PATH,
        };
        terminal.insert("termux_socket_path", value(migrated_socket));
    }
    terminal.remove("helper_socket_path");
    terminal.insert("user", value("sigmaos"));

    let metadata = fs::metadata(path)?;
    let backup_path = PathBuf::from(format!("{}{}", path.display(), BACKUP_SUFFIX));
    create_backup(&backup_path, &original)?;
    replace_atomically(path, document.to_string().as_bytes(), &metadata)?;
    Ok(MigrationOutcome {
        changed: true,
        backup_path: Some(backup_path),
    })
}

fn create_backup(path: &Path, content: &[u8]) -> Result<(), TermuxError> {
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
) -> Result<(), TermuxError> {
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(metadata.permissions().mode() & 0o777)
            .open(&temporary)?;
        file.write_all(content)?;
        file.sync_all()?;
        chown(
            &temporary,
            Some(Uid::from_raw(metadata.uid())),
            Some(Gid::from_raw(metadata.gid())),
        )?;
        fs::set_permissions(&temporary, metadata.permissions())?;
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

fn sync_parent(path: &Path) -> Result<(), TermuxError> {
    let parent = path
        .parent()
        .ok_or_else(|| TermuxError::validation("Configuration path has no parent directory"))?;
    File::open(parent)?.sync_all()?;
    Ok(())
}

pub fn configured_path() -> PathBuf {
    std::env::var_os("SIGMAOS_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_CONFIG_PATH))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_terminal_configuration_idempotently() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            "[terminal]\nuser = \"legacy\"\nhelper_socket_path = \"/tmp/custom.sock\"\n",
        )
        .unwrap();
        let outcome = migrate_config(&path).unwrap();
        assert!(outcome.changed);
        let migrated = fs::read_to_string(&path).unwrap();
        assert!(migrated.contains("termux_socket_path = \"/tmp/custom.sock\""));
        assert!(migrated.contains("user = \"sigmaos\""));
        assert!(!migrated.contains("helper_socket_path"));
        assert!(!migrate_config(&path).unwrap().changed);
    }

    #[test]
    fn replaces_the_legacy_default_socket() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml");
        fs::write(
            &path,
            format!(
                "[terminal]\nuser = \"sigmaos\"\nhelper_socket_path = \"{LEGACY_SOCKET_PATH}\"\n"
            ),
        )
        .unwrap();
        migrate_config(&path).unwrap();
        assert!(
            fs::read_to_string(&path)
                .unwrap()
                .contains(DEFAULT_SOCKET_PATH)
        );
    }
}
