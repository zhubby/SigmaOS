use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{ErrorCode, HostdError};

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestEnvelope {
    pub version: u8,
    pub id: String,
    pub operation: String,
    pub payload: Value,
}

#[derive(Debug, Serialize)]
pub struct ResponseEnvelope {
    pub version: u8,
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorEnvelope>,
}

#[derive(Debug, Serialize)]
pub struct ErrorEnvelope {
    pub status: u16,
    pub code: ErrorCode,
    pub message: String,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl RequestEnvelope {
    pub fn parse(frame: &[u8]) -> Result<Self, HostdError> {
        let request: Self = serde_json::from_slice(frame).map_err(|_| {
            HostdError::new(
                400,
                ErrorCode::ProtocolError,
                "Invalid JSONL request envelope",
            )
        })?;
        if request.version != PROTOCOL_VERSION {
            return Err(HostdError::new(
                400,
                ErrorCode::ProtocolError,
                "Unsupported hostd protocol version",
            ));
        }
        uuid::Uuid::parse_str(&request.id)
            .map_err(|_| HostdError::new(400, ErrorCode::ProtocolError, "Invalid request id"))?;
        if request.operation.is_empty() || request.operation.len() > 64 {
            return Err(HostdError::new(
                400,
                ErrorCode::ProtocolError,
                "Invalid operation name",
            ));
        }
        Ok(request)
    }
}

impl ResponseEnvelope {
    pub fn success(id: String, result: Value) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(id: String, error: HostdError) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id,
            ok: false,
            result: None,
            error: Some(ErrorEnvelope {
                status: error.status,
                code: error.code,
                message: error.message,
                details: error.details,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_request() {
        let request = RequestEnvelope::parse(
            br#"{"version":1,"id":"67e55044-10b1-426f-9247-bb680e5fe0c8","operation":"shares.apply","payload":{}}"#,
        )
        .unwrap();
        assert_eq!(request.operation, "shares.apply");
    }

    #[test]
    fn rejects_unknown_fields_and_versions() {
        assert!(RequestEnvelope::parse(
            br#"{"version":2,"id":"67e55044-10b1-426f-9247-bb680e5fe0c8","operation":"shares.apply","payload":{}}"#
        )
        .is_err());
        assert!(RequestEnvelope::parse(
            br#"{"version":1,"id":"67e55044-10b1-426f-9247-bb680e5fe0c8","operation":"shares.apply","payload":{},"extra":true}"#
        )
        .is_err());
    }
}
