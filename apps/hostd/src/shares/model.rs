use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub(super) const DEFAULT_MANAGED_ROOTS: &[&str] = &[
    "/etc/sigmaos",
    "/etc/samba/smb.conf.d",
    "/etc/apache2/sites-available",
    "/etc/vsftpd.d",
    "/etc/exports.d",
    "/etc/minidlna.d",
    "/etc/pam.d",
];

pub(super) const ALL_SERVICES: &[&str] = &[
    "smbd.service",
    "nmbd.service",
    "apache2.service",
    "vsftpd.service",
    "nfs-server.service",
    "minidlna.service",
];

#[derive(Debug, Clone)]
pub struct SharePaths {
    pub samba_config: PathBuf,
    pub webdav_site: PathBuf,
    pub ftp_config: PathBuf,
    pub nfs_exports: PathBuf,
    pub dlna_config: PathBuf,
    pub htpasswd: PathBuf,
    pub ftp_pam: PathBuf,
}

impl Default for SharePaths {
    fn default() -> Self {
        Self {
            samba_config: "/etc/samba/smb.conf.d/sigmaos-shares.conf".into(),
            webdav_site: "/etc/apache2/sites-available/sigmaos-webdav.conf".into(),
            ftp_config: "/etc/vsftpd.d/sigmaos-shares.conf".into(),
            nfs_exports: "/etc/exports.d/sigmaos.exports".into(),
            dlna_config: "/etc/minidlna.d/sigmaos.conf".into(),
            htpasswd: "/etc/sigmaos/shares.htpasswd".into(),
            ftp_pam: "/etc/pam.d/vsftpd-sigmaos".into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ShareOptions {
    pub paths: SharePaths,
    pub credential_group: String,
    pub managed_roots: Vec<PathBuf>,
}

impl Default for ShareOptions {
    fn default() -> Self {
        Self {
            paths: SharePaths::default(),
            credential_group: "sigmaos".to_owned(),
            managed_roots: DEFAULT_MANAGED_ROOTS.iter().map(PathBuf::from).collect(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareApplyRequest {
    pub settings: ShareSettings,
    pub roots: Vec<NasRoot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NasRoot {
    pub id: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSettings {
    pub enabled: bool,
    pub account: ShareAccount,
    pub shares: Vec<ShareDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareAccount {
    pub username: String,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub root_id: String,
    pub path: PathBuf,
    pub protocols: ShareProtocols,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ShareProtocols {
    pub smb: SmbConfig,
    pub webdav: WebDavConfig,
    pub ftp: FtpConfig,
    pub nfs: NfsConfig,
    pub dlna: DlnaConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbConfig {
    pub enabled: bool,
    pub read_only: bool,
    pub browseable: bool,
    pub allow_guest: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfig {
    pub enabled: bool,
    pub read_only: bool,
    pub allow_guest: bool,
    pub port: u16,
    pub path_prefix: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpConfig {
    pub enabled: bool,
    pub read_only: bool,
    pub port: u16,
    pub passive_port_start: u16,
    pub passive_port_end: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NfsConfig {
    pub enabled: bool,
    pub read_only: bool,
    pub allowed_cidrs: Vec<String>,
    pub root_squash: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DlnaConfig {
    pub enabled: bool,
    pub media_types: Vec<String>,
    pub bind_interface: Option<String>,
    pub bind_address: Option<String>,
    pub friendly_name: String,
}

#[derive(Debug)]
pub struct ResolvedShare<'a> {
    pub share: &'a ShareDefinition,
    pub absolute_path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ShareApplyResult {
    pub(super) applied_at: String,
    pub(super) files: Vec<String>,
    pub(super) services: Vec<String>,
}
