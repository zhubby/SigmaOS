use std::process::ExitCode;

use sigmaos_termux::config::TermuxConfig;
use sigmaos_termux::config_migration::{configured_path, migrate_config};
use sigmaos_termux::error::{ErrorCode, TermuxError};
use sigmaos_termux::server::TermuxServer;
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
            tracing::error!(code = ?error.code, message = %error.message, "termux stopped");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), TermuxError> {
    let mut arguments = std::env::args_os().skip(1);
    match arguments
        .next()
        .and_then(|argument| argument.into_string().ok())
    {
        None => TermuxServer::new(TermuxConfig::load()?).run().await,
        Some(command) if command == "migrate-config" && arguments.next().is_none() => {
            let path = configured_path();
            let outcome = migrate_config(&path)?;
            tracing::info!(
                path = %path.display(),
                changed = outcome.changed,
                backup = outcome.backup_path.as_ref().map(|path| path.display().to_string()),
                "termux configuration migration complete"
            );
            Ok(())
        }
        _ => Err(TermuxError::new(
            400,
            ErrorCode::Validation,
            "usage: sigmaos-termux [migrate-config]",
        )),
    }
}
