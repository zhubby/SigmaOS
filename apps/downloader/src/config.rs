use std::env;
use std::path::{Path, PathBuf};

use crate::error::{DownloadError, ErrorCode};

pub const DEFAULT_CONFIG_PATH: &str = "/etc/sigmaos/config.toml";

#[derive(Debug, Clone)]
pub struct Config {
    pub database_path: PathBuf,
}

impl Config {
    pub fn load() -> Result<Self, DownloadError> {
        if let Some(path) = env::var_os("SIGMAOS_DATABASE_PATH") {
            return Ok(Self {
                database_path: PathBuf::from(path),
            });
        }
        let config_path = env::var_os("SIGMAOS_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(DEFAULT_CONFIG_PATH));
        let data_dir = resolve_data_dir(&config_path, env::var_os("SIGMAOS_DATA_DIR"))?;
        Ok(Self {
            database_path: data_dir.join("sigmaos.sqlite"),
        })
    }
}

fn resolve_data_dir(
    config_path: &Path,
    environment_override: Option<std::ffi::OsString>,
) -> Result<PathBuf, DownloadError> {
    match environment_override {
        Some(path) => Ok(PathBuf::from(path)),
        None if config_path.exists() => data_dir_from_file(config_path),
        None => Ok(PathBuf::from(".sigmaos")),
    }
}

fn data_dir_from_file(path: &Path) -> Result<PathBuf, DownloadError> {
    let text = std::fs::read_to_string(path).map_err(DownloadError::storage)?;
    let document = text.parse::<toml_edit::DocumentMut>().map_err(|error| {
        DownloadError::new(
            ErrorCode::Internal,
            format!("invalid SigmaOS config: {error}"),
            false,
        )
    })?;
    Ok(document
        .get("data_dir")
        .and_then(toml_edit::Item::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(".sigmaos")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_data_directory_overrides_the_config_file() {
        let directory = tempfile::tempdir().unwrap();
        let config = directory.path().join("config.toml");
        std::fs::write(&config, "data_dir = '/production'\n").unwrap();
        assert_eq!(
            resolve_data_dir(&config, Some("/isolated".into())).unwrap(),
            PathBuf::from("/isolated")
        );
        assert_eq!(
            resolve_data_dir(&config, None).unwrap(),
            PathBuf::from("/production")
        );
    }
}
