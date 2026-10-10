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

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkManagerRequest")
)]
#[serde(tag = "action", rename_all = "snake_case")]
pub(crate) enum NetworkRequest {
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

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkScanInput"))]
pub(crate) struct ScanInput {
    pub(super) device: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkConnectInput"))]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectInput {
    pub(super) device: String,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) profile_id: Option<String>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) ssid: Option<String>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) security: Option<String>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) password: Option<String>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) bssid: Option<String>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) autoconnect: Option<bool>,
    #[serde(rename = "confirmed")]
    pub(super) _confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkConfirmedDeviceInput")
)]
pub(crate) struct ConfirmedDeviceInput {
    pub(super) device: String,
    pub(super) confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkRadioInput"))]
pub(crate) struct RadioInput {
    pub(super) enabled: bool,
    pub(super) confirmed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkProfileUpdateInput")
)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileUpdateInput {
    pub(super) expected_revision: String,
    pub(super) confirmed: bool,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) ssid: Option<String>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) security: Option<String>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) autoconnect: Option<bool>,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkHotspotUpdateInput")
)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HotspotUpdateInput {
    pub(super) device: String,
    pub(super) ssid: String,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) password: Option<String>,
    pub(super) band: String,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) channel: Option<u16>,
    pub(super) autostart: bool,
    #[cfg_attr(test, ts(optional = nullable))]
    pub(super) expected_revision: Option<String>,
    pub(super) confirmed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkRollbackStatus")
)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RollbackStatus {
    NotRequired,
    Succeeded,
    Failed,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkMutationResult")
)]
pub(crate) struct MutationResult {
    pub(super) rollback: RollbackStatus,
    pub(super) message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkProfileInspection")
)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileInspection {
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
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkRecoveryEntry"))]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryEntry {
    pub(super) restore_profile_id: Option<String>,
    pub(super) hotspot_profile_id: String,
}

pub(super) type RecoveryState = HashMap<String, RecoveryEntry>;

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkPingResult"))]
pub(crate) struct PingResult {
    #[cfg_attr(test, ts(type = "true"))]
    pub(super) ready: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(
    test,
    ts(export_to = "hostd.ts", rename = "HostdNetworkInspectionResult")
)]
pub(crate) struct InspectionResult {
    pub(super) profiles: Vec<ProfileInspection>,
    pub(super) recovery: RecoveryState,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkAccessPoint"))]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessPoint {
    pub(super) active: bool,
    pub(super) ssid: String,
    pub(super) bssid: String,
    pub(super) channel: u16,
    #[serde(rename = "frequencyMHz")]
    pub(super) frequency_mhz: u32,
    pub(super) signal: i32,
    pub(super) band: String,
    pub(super) security: String,
    pub(super) saved_profile_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkScanResult"))]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanResult {
    pub(super) device: String,
    pub(super) scanned_at: String,
    pub(super) access_points: Vec<AccessPoint>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdNetworkManagerResult"))]
#[serde(untagged)]
pub(crate) enum NetworkResult {
    Ping(PingResult),
    Inspection(InspectionResult),
    Scan(ScanResult),
    Mutation(MutationResult),
}
