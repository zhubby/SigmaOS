use std::process::ExitCode;

use sigmaos_vod_player::config::{VodPlayerConfig, configured_path};
use sigmaos_vod_player::config_migration::migrate_config;
use sigmaos_vod_player::error::{ErrorCode, VodError};
use sigmaos_vod_player::server::VodPlayerServer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(code = ?error.code, message = %error.message, "VOD player stopped");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), VodError> {
    let mut arguments = std::env::args_os().skip(1);
    match arguments
        .next()
        .and_then(|argument| argument.into_string().ok())
    {
        None => {
            let config = VodPlayerConfig::load()?;
            if !config.enabled {
                tracing::info!("VOD player is disabled");
                return Ok(());
            }
            VodPlayerServer::new(config).await?.run().await
        }
        Some(command) if command == "migrate-config" && arguments.next().is_none() => {
            let path = configured_path();
            let outcome = migrate_config(&path)?;
            tracing::info!(path = %path.display(), changed = outcome.changed, backup = outcome.backup_path.as_ref().map(|path| path.display().to_string()), "VOD player configuration migration complete");
            Ok(())
        }
        _ => Err(VodError::new(
            ErrorCode::InvalidCommand,
            "usage: sigmaos-vod-player [migrate-config]",
            400,
        )),
    }
}
