use serde::Deserialize;
use serde_json::{Value, json};

use crate::command::{CommandRunner, run_checked};
use crate::error::HostdError;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PowerRequest {
    action: PowerAction,
    confirmed: bool,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum PowerAction {
    Reboot,
    Shutdown,
}

pub async fn command(payload: Value, runner: &dyn CommandRunner) -> Result<Value, HostdError> {
    let request: PowerRequest = serde_json::from_value(payload)
        .map_err(|_| HostdError::validation("A confirmed power action is required"))?;
    if !request.confirmed {
        return Err(HostdError::validation(
            "Power action confirmation is required",
        ));
    }

    let action = match request.action {
        PowerAction::Reboot => "reboot",
        PowerAction::Shutdown => "poweroff",
    };
    run_checked(runner, "systemctl", &["--no-block", action], None).await?;
    Ok(json!({
        "action": if action == "reboot" { "reboot" } else { "shutdown" },
        "accepted": true
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;
    use std::time::Duration;

    #[derive(Default)]
    struct FakeRunner {
        calls: Mutex<Vec<(String, Vec<String>)>>,
        success: bool,
    }

    #[async_trait]
    impl CommandRunner for FakeRunner {
        async fn run(
            &self,
            command: &str,
            args: &[String],
            _input: Option<&[u8]>,
            _command_timeout: Duration,
            _output_limit: usize,
        ) -> Result<crate::command::CommandOutput, HostdError> {
            self.calls
                .lock()
                .unwrap()
                .push((command.to_owned(), args.to_vec()));
            Ok(crate::command::CommandOutput {
                stdout: String::new(),
                stderr: String::new(),
                success: self.success,
            })
        }
    }

    #[tokio::test]
    async fn maps_reboot_to_fixed_systemctl_command() {
        let runner = FakeRunner {
            success: true,
            ..Default::default()
        };
        let result = command(json!({ "action": "reboot", "confirmed": true }), &runner)
            .await
            .unwrap();
        assert_eq!(result, json!({ "action": "reboot", "accepted": true }));
        assert_eq!(
            runner.calls.lock().unwrap().as_slice(),
            &[(
                "systemctl".to_owned(),
                vec!["--no-block".to_owned(), "reboot".to_owned()]
            )]
        );
    }

    #[tokio::test]
    async fn maps_shutdown_to_poweroff_without_accepting_extra_arguments() {
        let runner = FakeRunner {
            success: true,
            ..Default::default()
        };
        let result = command(json!({ "action": "shutdown", "confirmed": true }), &runner)
            .await
            .unwrap();
        assert_eq!(result, json!({ "action": "shutdown", "accepted": true }));
        assert_eq!(
            runner.calls.lock().unwrap().as_slice(),
            &[(
                "systemctl".to_owned(),
                vec!["--no-block".to_owned(), "poweroff".to_owned()]
            )]
        );
    }

    #[tokio::test]
    async fn rejects_unconfirmed_unknown_and_extra_fields() {
        let runner = FakeRunner {
            success: true,
            ..Default::default()
        };
        for payload in [
            json!({ "action": "reboot", "confirmed": false }),
            json!({ "action": "hibernate", "confirmed": true }),
            json!({ "action": "reboot", "confirmed": true, "command": "rm -rf /" }),
        ] {
            assert!(command(payload, &runner).await.is_err());
        }
        assert!(runner.calls.lock().unwrap().is_empty());
    }
}
