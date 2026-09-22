use std::process::ExitCode;

use sigmaos_hostd::config::{DEFAULT_CONFIG_PATH, HostdConfig};
use sigmaos_hostd::config_migration::{migrate_config, migrate_terminal_config};
use sigmaos_hostd::error::{ErrorCode, HostdError};
use sigmaos_hostd::server::HostdServer;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let result = run().await;
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(code = ?error.code, message = %error.message, "hostd stopped");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), HostdError> {
    let mut arguments = std::env::args_os().skip(1);
    match arguments
        .next()
        .and_then(|argument| argument.into_string().ok())
    {
        None => {
            let config = HostdConfig::load()?;
            HostdServer::new(config).run().await
        }
        Some(command) if command == "migrate-config" && arguments.next().is_none() => {
            let config_path = std::env::var_os("SIGMAOS_CONFIG")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::path::PathBuf::from(DEFAULT_CONFIG_PATH));
            let outcome = migrate_config(&config_path)?;
            let terminal_outcome = migrate_terminal_config(&config_path)?;
            tracing::info!(
                path = %config_path.display(),
                changed = outcome.changed,
                backup = outcome.backup_path.as_ref().map(|path| path.display().to_string()),
                "hostd configuration migration complete"
            );
            tracing::info!(
                changed = terminal_outcome.changed,
                backup = terminal_outcome
                    .backup_path
                    .as_ref()
                    .map(|path| path.display().to_string()),
                "terminal configuration migration complete"
            );
            Ok(())
        }
        _ => Err(HostdError::new(
            400,
            ErrorCode::Validation,
            "usage: sigmaos-hostd [migrate-config]",
        )),
    }
}
