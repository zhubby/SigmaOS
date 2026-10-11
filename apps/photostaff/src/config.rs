use std::env;
use std::fs::{File, OpenOptions};
#[cfg(target_os = "linux")]
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

#[cfg(target_os = "linux")]
use nix::fcntl::{RenameFlags, renameat2};

use crate::error::{ErrorCode, PhotostaffError};

pub const DEFAULT_CONFIG_PATH: &str = "/etc/sigmaos/config.toml";

#[derive(Debug, Clone)]
pub struct Config {
    pub database_path: PathBuf,
    pub data_dir: PathBuf,
    pub cache_root: PathBuf,
}

impl Config {
    pub fn load() -> Result<Self, PhotostaffError> {
        reject_legacy_environment()?;
        let config_path = env::var_os("SIGMAOS_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_CONFIG_PATH));
        let data_dir = match env::var_os("SIGMAOS_DATA_DIR") {
            Some(path) => PathBuf::from(path),
            None if config_path.exists() => data_dir_from_file(&config_path)?,
            None => PathBuf::from(".sigmaos"),
        };
        let database_path = env::var_os("SIGMAOS_DATABASE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| data_dir.join("sigmaos.sqlite"));
        Ok(Self {
            database_path,
            cache_root: data_dir.join("photostaff"),
            data_dir,
        })
    }

    pub fn migrate_cache(&self) -> Result<(), PhotostaffError> {
        let old = self.data_dir.join("photos");
        let new = &self.cache_root;
        match (cache_directory_exists(&old)?, cache_directory_exists(new)?) {
            (true, true) => Err(PhotostaffError::new(
                ErrorCode::PublishConflict,
                "Both legacy photos and photostaff cache directories exist",
                false,
            )),
            (true, false) => {
                rename_cache_no_replace(&old, new)?;
                sync_parent(new)
            }
            (false, _) => {
                std::fs::create_dir_all(new).map_err(PhotostaffError::storage)?;
                sync_parent(new)
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn rename_cache_no_replace(old: &Path, new: &Path) -> Result<(), PhotostaffError> {
    let parent = old
        .parent()
        .filter(|parent| new.parent() == Some(*parent))
        .ok_or_else(|| PhotostaffError::internal("Cache migration must stay in one directory"))?;
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_DIRECTORY | nix::libc::O_NOFOLLOW | nix::libc::O_CLOEXEC)
        .open(parent)
        .map_err(PhotostaffError::storage)?;
    renameat2(
        &directory,
        Path::new(old.file_name().unwrap()),
        &directory,
        Path::new(new.file_name().unwrap()),
        RenameFlags::RENAME_NOREPLACE,
    )
    .map_err(|error| {
        if error == nix::errno::Errno::EEXIST {
            PhotostaffError::new(
                ErrorCode::PublishConflict,
                "Photostaff cache migration target already exists",
                false,
            )
        } else {
            PhotostaffError::storage(error)
        }
    })
}

#[cfg(not(target_os = "linux"))]
fn rename_cache_no_replace(old: &Path, new: &Path) -> Result<(), PhotostaffError> {
    if new.exists() {
        return Err(PhotostaffError::new(
            ErrorCode::PublishConflict,
            "Photostaff cache migration target already exists",
            false,
        ));
    }
    std::fs::rename(old, new).map_err(PhotostaffError::storage)
}

fn cache_directory_exists(path: &Path) -> Result<bool, PhotostaffError> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(PhotostaffError::new(
            ErrorCode::PublishConflict,
            format!(
                "Photostaff cache path is not a real directory: {}",
                path.display()
            ),
            false,
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(PhotostaffError::storage(error)),
    }
}

pub fn verify_tools() -> Result<(), PhotostaffError> {
    for tool in [
        "exiftool",
        "vipsthumbnail",
        "vipsheader",
        "ffprobe",
        "ffmpeg",
        "dcraw_emu",
        "heif-convert",
    ] {
        if find_in_path(tool).is_none() {
            return Err(PhotostaffError::new(
                ErrorCode::ToolUnavailable,
                format!("Required media tool is unavailable: {tool}"),
                true,
            ));
        }
    }
    Ok(())
}

fn data_dir_from_file(path: &Path) -> Result<PathBuf, PhotostaffError> {
    let text = std::fs::read_to_string(path).map_err(PhotostaffError::storage)?;
    let document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|error| PhotostaffError::internal(format!("Invalid SigmaOS config: {error}")))?;
    Ok(document
        .get("data_dir")
        .and_then(toml_edit::Item::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".sigmaos")))
}

fn reject_legacy_environment() -> Result<(), PhotostaffError> {
    if env::vars_os().any(|(name, _)| name.to_string_lossy().starts_with("SIGMAOS_PHOTO_")) {
        return Err(PhotostaffError::new(
            ErrorCode::Internal,
            "Legacy SIGMAOS_PHOTO_* variables are not supported; use SIGMAOS_PHOTOSTAFF_*",
            false,
        ));
    }
    Ok(())
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|value| {
        env::split_paths(&value)
            .map(|directory| directory.join(name))
            .find(|candidate| {
                candidate.metadata().is_ok_and(|metadata| {
                    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                })
            })
    })
}

fn sync_parent(path: &Path) -> Result<(), PhotostaffError> {
    let parent = path
        .parent()
        .ok_or_else(|| PhotostaffError::internal("Cache has no parent"))?;
    let directory = OpenOptions::new()
        .read(true)
        .open(parent)
        .map_err(PhotostaffError::storage)?;
    directory.sync_all().map_err(PhotostaffError::storage)
}

pub fn sync_file_and_parent(path: &Path) -> Result<(), PhotostaffError> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(PhotostaffError::storage)?;
    sync_parent(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_cache_atomically_and_refuses_conflicts() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("photos")).unwrap();
        std::fs::write(directory.path().join("photos/item"), b"x").unwrap();
        let config = Config {
            database_path: directory.path().join("db"),
            data_dir: directory.path().to_owned(),
            cache_root: directory.path().join("photostaff"),
        };
        config.migrate_cache().unwrap();
        assert_eq!(std::fs::read(config.cache_root.join("item")).unwrap(), b"x");
        std::fs::create_dir(directory.path().join("photos")).unwrap();
        assert!(config.migrate_cache().is_err());
    }

    #[test]
    fn refuses_symlinked_cache_directories() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let outside = directory.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        symlink(&outside, directory.path().join("photos")).unwrap();
        let config = Config {
            database_path: directory.path().join("db"),
            data_dir: directory.path().to_owned(),
            cache_root: directory.path().join("photostaff"),
        };

        assert_eq!(
            config.migrate_cache().unwrap_err().code,
            ErrorCode::PublishConflict
        );
    }
}
