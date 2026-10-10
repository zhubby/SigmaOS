use serde::{Deserialize, Serialize};

use crate::error::{ErrorCode, VodError};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_FRAME_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestEnvelope {
    pub version: u8,
    pub id: String,
    pub command: Command,
}

impl RequestEnvelope {
    pub fn parse(bytes: &[u8]) -> Result<Self, VodError> {
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(VodError::protocol("VOD player request exceeds 128 KiB"));
        }
        let value: serde_json::Value = serde_json::from_slice(bytes)
            .map_err(|_| VodError::protocol("Invalid VOD player request"))?;
        validate_command_fields(&value)?;
        let request: Self = serde_json::from_value(value)
            .map_err(|_| VodError::protocol("Invalid VOD player request"))?;
        if request.version != PROTOCOL_VERSION {
            return Err(VodError::protocol(
                "Unsupported VOD player protocol version",
            ));
        }
        if request.id.is_empty() || request.id.len() > 128 || request.id.contains('\0') {
            return Err(VodError::protocol("Invalid VOD player request id"));
        }
        request.command.validate()?;
        Ok(request)
    }
}

fn validate_command_fields(value: &serde_json::Value) -> Result<(), VodError> {
    let command = value
        .get("command")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| VodError::protocol("Invalid VOD player request"))?;
    let command_type = command
        .get("type")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| VodError::protocol("Invalid VOD player command"))?;
    let allowed: &[&str] = match command_type {
        "status" => &["type"],
        "play" => &[
            "type",
            "rootId",
            "storagePoolId",
            "relativePath",
            "startPositionSeconds",
        ],
        "pause" | "resume" | "stop" | "retry" => &["type", "sessionId"],
        "seek" => &["type", "sessionId", "seconds"],
        "set-volume" => &["type", "sessionId", "volume"],
        _ => {
            return Err(VodError::new(
                ErrorCode::InvalidCommand,
                "Unsupported VOD player command",
                400,
            ));
        }
    };
    if command.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(VodError::protocol(
            "VOD player command contains unknown fields",
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Command {
    Status,
    Play {
        #[serde(rename = "rootId")]
        root_id: String,
        #[serde(rename = "storagePoolId")]
        storage_pool_id: String,
        #[serde(rename = "relativePath")]
        relative_path: String,
        #[serde(rename = "startPositionSeconds")]
        start_position_seconds: Option<f64>,
    },
    Pause {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Resume {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Stop {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Retry {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Seek {
        #[serde(rename = "sessionId")]
        session_id: String,
        seconds: f64,
    },
    SetVolume {
        #[serde(rename = "sessionId")]
        session_id: String,
        volume: f64,
    },
}

impl Command {
    fn validate(&self) -> Result<(), VodError> {
        match self {
            Self::Status => Ok(()),
            Self::Play {
                root_id,
                storage_pool_id,
                relative_path,
                start_position_seconds,
            } => {
                validate_id(root_id)?;
                validate_id(storage_pool_id)?;
                validate_relative_path(relative_path)?;
                if start_position_seconds.is_some_and(|value| !value.is_finite() || value < 0.0) {
                    return Err(VodError::new(
                        ErrorCode::InvalidCommand,
                        "Start position must be a non-negative number",
                        400,
                    ));
                }
                Ok(())
            }
            Self::Pause { session_id }
            | Self::Resume { session_id }
            | Self::Stop { session_id }
            | Self::Retry { session_id } => validate_id(session_id),
            Self::Seek {
                session_id,
                seconds,
            } => {
                validate_id(session_id)?;
                validate_number(*seconds, 0.0, f64::MAX, "seek position")
            }
            Self::SetVolume { session_id, volume } => {
                validate_id(session_id)?;
                validate_number(*volume, 0.0, 100.0, "volume")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayerState {
    Idle,
    Starting,
    Playing,
    Paused,
    Recovering,
    Stopped,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub mpv_available: bool,
    pub drm_available: bool,
    pub audio_available: bool,
    pub hardware_decode: HardwareDecode,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HardwareDecode {
    Enabled,
    Software,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: PlayerState,
    pub session_id: Option<String>,
    pub service_instance_id: String,
    pub revision: u64,
    pub root_id: Option<String>,
    pub storage_pool_id: Option<String>,
    pub relative_path: Option<String>,
    pub file_name: Option<String>,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub volume: f64,
    pub retry_count: u32,
    pub next_retry_at: Option<String>,
    pub capabilities: Capabilities,
    pub error: Option<String>,
    pub error_code: Option<ErrorCode>,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResponse<'a> {
    pub version: u8,
    pub id: &'a str,
    pub ok: bool,
    pub status: &'a Status,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse<'a> {
    pub version: u8,
    pub id: &'a str,
    pub ok: bool,
    pub error: &'a str,
    pub code: ErrorCode,
    pub status_code: u16,
}

fn validate_id(value: &str) -> Result<(), VodError> {
    if value.is_empty() || value.len() > 256 || value.contains('\0') {
        return Err(VodError::new(
            ErrorCode::InvalidCommand,
            "Invalid VOD player identifier",
            400,
        ));
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<(), VodError> {
    if value.starts_with('/')
        || value
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || value.contains('\0')
    {
        return Err(VodError::invalid_path(
            "Media path must remain inside the selected storage pool",
        ));
    }
    Ok(())
}

fn validate_number(value: f64, minimum: f64, maximum: f64, name: &str) -> Result<(), VodError> {
    if !value.is_finite() || value < minimum || value > maximum {
        return Err(VodError::new(
            ErrorCode::InvalidCommand,
            format!("Invalid {name}"),
            400,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_strict_versioned_commands() {
        let request = RequestEnvelope::parse(
            br#"{"version":1,"id":"r1","command":{"type":"play","rootId":"root","storagePoolId":"pool","relativePath":"movies/a.mp4","startPositionSeconds":4}}"#,
        )
        .unwrap();
        assert!(matches!(request.command, Command::Play { .. }));
        assert!(RequestEnvelope::parse(br#"{"id":"r1","command":{"type":"status"}}"#).is_err());
        assert!(
            RequestEnvelope::parse(
                br#"{"version":1,"id":"r1","command":{"type":"status","extra":true}}"#
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_unsafe_paths_and_unbound_controls() {
        assert!(RequestEnvelope::parse(br#"{"version":1,"id":"r1","command":{"type":"play","rootId":"root","storagePoolId":"pool","relativePath":"../a.mp4"}}"#).is_err());
        assert!(
            RequestEnvelope::parse(br#"{"version":1,"id":"r1","command":{"type":"pause"}}"#)
                .is_err()
        );
    }
}
