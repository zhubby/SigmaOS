use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const CONNECTIONS_DIR: &str = "/etc/NetworkManager/system-connections";
const STATE_DIR: &str = "/var/lib/sigmaos/network-manager";
pub(super) const MANAGED_PREFIX: &str = "sigmaos-";

#[derive(Debug, Clone)]
pub struct NetworkOptions {
    pub connections_dir: PathBuf,
    pub state_dir: PathBuf,
}

impl Default for NetworkOptions {
    fn default() -> Self {
        Self {
            connections_dir: CONNECTIONS_DIR.into(),
            state_dir: STATE_DIR.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub(super) enum NetworkRequest {
    Ping,
    Inspect,
    Scan {
        input: ScanInput,
    },
    Connect {
        input: ConnectInput,
    },
    Disconnect {
        input: ConfirmedDeviceInput,
    },
    Radio {
        input: RadioInput,
    },
    UpdateProfile {
        #[serde(rename = "profileId")]
        profile_id: String,
        input: ProfileUpdateInput,
    },
    DeleteProfile {
        #[serde(rename = "profileId")]
        profile_id: String,
        confirmed: bool,
    },
    UpdateHotspot {
        input: HotspotUpdateInput,
    },
    StartHotspot {
        input: ConfirmedDeviceInput,
    },
    StopHotspot {
        input: ConfirmedDeviceInput,
    },
    DeleteHotspot {
        input: ConfirmedDeviceInput,
    },
}

#[derive(Debug, Deserialize)]
pub(super) struct ScanInput {
    pub(super) device: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ConnectInput {
    pub(super) device: String,
    pub(super) profile_id: Option<String>,
    pub(super) ssid: Option<String>,
    pub(super) security: Option<String>,
    pub(super) password: Option<String>,
    pub(super) bssid: Option<String>,
    pub(super) autoconnect: Option<bool>,
    #[serde(rename = "confirmed")]
    pub(super) _confirmed: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct ConfirmedDeviceInput {
    pub(super) device: String,
    pub(super) confirmed: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct RadioInput {
    pub(super) enabled: bool,
    pub(super) confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileUpdateInput {
    pub(super) expected_revision: String,
    pub(super) confirmed: bool,
    pub(super) ssid: Option<String>,
    pub(super) security: Option<String>,
    pub(super) autoconnect: Option<bool>,
    pub(super) password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HotspotUpdateInput {
    pub(super) device: String,
    pub(super) ssid: String,
    pub(super) password: Option<String>,
    pub(super) band: String,
    pub(super) channel: Option<u16>,
    pub(super) autostart: bool,
    pub(super) expected_revision: Option<String>,
    pub(super) confirmed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum RollbackStatus {
    NotRequired,
    Succeeded,
    Failed,
}

#[derive(Debug, Serialize)]
pub(super) struct MutationResult {
    pub(super) rollback: RollbackStatus,
    pub(super) message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileInspection {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) ssid: String,
    pub(super) device: Option<String>,
    pub(super) security: String,
    pub(super) mode: String,
    pub(super) band: String,
    pub(super) channel: Option<u16>,
    pub(super) autoconnect: bool,
    pub(super) credential_configured: bool,
    pub(super) revision: String,
}

#[derive(Debug, Clone)]
pub(super) struct ManagedProfile {
    pub(super) path: PathBuf,
    pub(super) content: String,
    pub(super) inspection: ProfileInspection,
}

#[derive(Debug)]
pub(super) struct ProfileDefinition {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) ssid: String,
    pub(super) device: String,
    pub(super) security: String,
    pub(super) password: Option<String>,
    pub(super) mode: String,
    pub(super) band: String,
    pub(super) channel: Option<u16>,
    pub(super) autoconnect: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecoveryEntry {
    pub(super) restore_profile_id: Option<String>,
    pub(super) hotspot_profile_id: String,
}

pub(super) type RecoveryState = HashMap<String, RecoveryEntry>;
