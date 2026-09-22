mod credentials;
mod files;
mod model;
mod render;
mod validation;

use std::collections::BTreeSet;

use serde_json::Value;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::command::{CommandRunner, run_checked};
use crate::config::ConfiguredNasRoot;
use crate::error::HostdError;

use credentials::apply_credentials;
use files::{restore_files, snapshot_files, write_managed_file};
use model::{ALL_SERVICES, ShareApplyResult};
pub use model::{
    DlnaConfig, FtpConfig, NasRoot, NfsConfig, ResolvedShare, ShareAccount, ShareApplyRequest,
    ShareDefinition, ShareOptions, SharePaths, ShareProtocols, ShareSettings, SmbConfig,
    WebDavConfig,
};
pub use render::{
    render_dlna, render_ftp, render_ftp_pam, render_nfs, render_samba, render_webdav,
};
use validation::{resolve_shares, validate_request, validate_requested_roots};

pub async fn apply(
    payload: Value,
    runner: &dyn CommandRunner,
    configured_roots: &[ConfiguredNasRoot],
) -> Result<Value, HostdError> {
    let request: ShareApplyRequest = serde_json::from_value(payload)
        .map_err(|_| HostdError::validation("Invalid shares.apply payload"))?;
    let result =
        apply_with_options(&request, runner, &ShareOptions::default(), configured_roots).await?;
    serde_json::to_value(result).map_err(|error| HostdError::operation_failed(error.to_string()))
}

async fn apply_with_options(
    request: &ShareApplyRequest,
    runner: &dyn CommandRunner,
    options: &ShareOptions,
    configured_roots: &[ConfiguredNasRoot],
) -> Result<ShareApplyResult, HostdError> {
    validate_request(request)?;
    validate_requested_roots(&request.roots, configured_roots)?;
    let resolved = resolve_shares(&request.settings, configured_roots).await?;
    let files = vec![
        (
            options.paths.samba_config.clone(),
            render_samba(&request.settings, &resolved)?,
        ),
        (
            options.paths.webdav_site.clone(),
            render_webdav(&request.settings, &resolved, &options.paths.htpasswd)?,
        ),
        (
            options.paths.ftp_config.clone(),
            render_ftp(&request.settings, &resolved, &options.paths.ftp_pam)?,
        ),
        (
            options.paths.nfs_exports.clone(),
            render_nfs(&request.settings, &resolved)?,
        ),
        (
            options.paths.dlna_config.clone(),
            render_dlna(&request.settings, &resolved)?,
        ),
        (
            options.paths.ftp_pam.clone(),
            render_ftp_pam(&options.paths.htpasswd),
        ),
    ];
    let services = services_for_settings(&request.settings);
    let service_actions = ALL_SERVICES
        .iter()
        .map(|service| {
            let action = if services.iter().any(|enabled| enabled == service) {
                "reload-or-restart"
            } else {
                "try-reload-or-restart"
            };
            ((*service).to_owned(), action)
        })
        .collect::<Vec<_>>();
    let snapshot = snapshot_files(files.iter().map(|(path, _)| path.as_path())).await?;
    let mut attempted_services = Vec::new();

    let operation = async {
        apply_credentials(
            &request.settings,
            &options.paths,
            runner,
            &options.credential_group,
        )
        .await?;
        for (path, content) in &files {
            write_managed_file(path, content, &options.managed_roots).await?;
        }
        for (service, action) in &service_actions {
            attempted_services.push((service.clone(), *action));
            run_checked(runner, "systemctl", &[*action, service.as_str()], None).await?;
        }
        Ok::<(), HostdError>(())
    }
    .await;
    if let Err(error) = operation {
        restore_files(&snapshot).await;
        for (service, action) in attempted_services.iter().rev() {
            let _ = run_checked(runner, "systemctl", &[*action, service.as_str()], None).await;
        }
        return Err(error);
    }

    Ok(ShareApplyResult {
        applied_at: OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .map_err(|error| HostdError::operation_failed(error.to_string()))?,
        files: files
            .iter()
            .map(|(path, _)| path.to_string_lossy().into_owned())
            .collect(),
        services,
    })
}

fn services_for_settings(settings: &ShareSettings) -> Vec<String> {
    if !settings.enabled {
        return ALL_SERVICES
            .iter()
            .map(|service| (*service).to_owned())
            .collect();
    }
    let mut services = BTreeSet::new();
    for share in &settings.shares {
        if share.protocols.smb.enabled {
            services.extend(["smbd.service", "nmbd.service"]);
        }
        if share.protocols.webdav.enabled {
            services.insert("apache2.service");
        }
        if share.protocols.ftp.enabled {
            services.insert("vsftpd.service");
        }
        if share.protocols.nfs.enabled {
            services.insert("nfs-server.service");
        }
        if share.protocols.dlna.enabled {
            services.insert("minidlna.service");
        }
    }
    ALL_SERVICES
        .iter()
        .filter(|service| services.contains(**service))
        .map(|service| (*service).to_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::Duration;
    use tempfile::TempDir;
    use tokio::fs;

    type CommandCall = (String, Vec<String>, Option<Vec<u8>>);

    #[derive(Default)]
    struct FakeRunner {
        calls: Mutex<Vec<CommandCall>>,
        fail_service: Option<String>,
    }

    #[async_trait]
    impl CommandRunner for FakeRunner {
        async fn run(
            &self,
            command: &str,
            args: &[String],
            input: Option<&[u8]>,
            _timeout: Duration,
            _output_limit: usize,
        ) -> Result<crate::command::CommandOutput, HostdError> {
            self.calls.lock().unwrap().push((
                command.to_owned(),
                args.to_vec(),
                input.map(<[u8]>::to_vec),
            ));
            let success = self
                .fail_service
                .as_ref()
                .is_none_or(|service| !args.contains(service));
            Ok(crate::command::CommandOutput {
                stdout: String::new(),
                stderr: if success {
                    String::new()
                } else {
                    "reload failed".to_owned()
                },
                success,
            })
        }
    }

    fn fixture(root: &Path) -> ShareApplyRequest {
        serde_json::from_value(serde_json::json!({
            "settings": {
                "enabled": true,
                "account": { "username": "sigma_share", "password": null },
                "shares": [{
                    "id": "media", "name": "Media", "description": "LAN media",
                    "rootId": "primary", "path": "media",
                    "protocols": {
                        "smb": { "enabled": true, "readOnly": false, "browseable": true, "allowGuest": false },
                        "webdav": { "enabled": true, "readOnly": true, "allowGuest": false, "port": 8088, "pathPrefix": "/shares/media" },
                        "ftp": { "enabled": true, "readOnly": true, "allowGuest": false, "port": 2121, "passivePortStart": 50000, "passivePortEnd": 50100 },
                        "nfs": { "enabled": true, "readOnly": true, "allowedCidrs": ["192.168.1.0/24"], "rootSquash": true },
                        "dlna": { "enabled": true, "mediaTypes": ["audio", "video"], "bindInterface": "eth0", "bindAddress": null, "friendlyName": "Sigma Media" }
                    }
                }]
            },
            "roots": [{ "id": "primary", "path": root }]
        }))
        .unwrap()
    }

    fn test_options(temp: &TempDir) -> ShareOptions {
        let etc = temp.path().join("etc");
        ShareOptions {
            paths: SharePaths {
                samba_config: etc.join("samba/sigmaos.conf"),
                webdav_site: etc.join("apache/sigmaos.conf"),
                ftp_config: etc.join("vsftpd/sigmaos.conf"),
                nfs_exports: etc.join("exports/sigmaos.exports"),
                dlna_config: etc.join("minidlna/sigmaos.conf"),
                htpasswd: etc.join("sigmaos/shares.htpasswd"),
                ftp_pam: etc.join("pam/vsftpd-sigmaos"),
            },
            credential_group: "sigmaos".to_owned(),
            managed_roots: vec![etc],
        }
    }

    fn configured_roots(request: &ShareApplyRequest) -> Vec<ConfiguredNasRoot> {
        request
            .roots
            .iter()
            .map(|root| ConfiguredNasRoot {
                id: root.id.clone(),
                path: root.path.clone(),
            })
            .collect()
    }

    #[tokio::test]
    async fn renders_configs_and_reloads_only_enabled_services() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("nas/media"))
            .await
            .unwrap();
        let request = fixture(&temp.path().join("nas"));
        let options = test_options(&temp);
        let runner = FakeRunner::default();
        let result = apply_with_options(&request, &runner, &options, &configured_roots(&request))
            .await
            .unwrap();
        assert_eq!(result.services, ALL_SERVICES);
        let samba = fs::read_to_string(&options.paths.samba_config)
            .await
            .unwrap();
        assert!(samba.contains("[sigmaos-media]"));
        assert!(samba.contains("valid users = sigma_share"));
        assert_eq!(
            fs::metadata(&options.paths.samba_config)
                .await
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        let nfs = fs::read_to_string(&options.paths.nfs_exports)
            .await
            .unwrap();
        assert!(nfs.contains("192.168.1.0/24(ro,sync,subtree_check,root_squash)"));
        let dlna = fs::read_to_string(&options.paths.dlna_config)
            .await
            .unwrap();
        assert!(dlna.contains("media_dir=A,"));
        assert!(dlna.contains("network_interface=eth0"));
    }

    #[tokio::test]
    async fn restores_files_when_a_reload_fails() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("nas/media"))
            .await
            .unwrap();
        let request = fixture(&temp.path().join("nas"));
        let options = test_options(&temp);
        if let Some(parent) = options.paths.samba_config.parent() {
            fs::create_dir_all(parent).await.unwrap();
        }
        fs::write(&options.paths.samba_config, "original\n")
            .await
            .unwrap();
        let runner = FakeRunner {
            fail_service: Some("apache2.service".to_owned()),
            ..FakeRunner::default()
        };
        assert!(
            apply_with_options(&request, &runner, &options, &configured_roots(&request))
                .await
                .is_err()
        );
        assert_eq!(
            fs::read_to_string(&options.paths.samba_config)
                .await
                .unwrap(),
            "original\n"
        );
        assert!(!options.paths.webdav_site.exists());
        let calls = runner.calls.lock().unwrap();
        assert_eq!(
            calls
                .iter()
                .filter(|(command, args, _)| {
                    command == "systemctl" && args == &["reload-or-restart", "smbd.service"]
                })
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn refreshes_running_services_when_a_protocol_is_disabled() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("nas/media"))
            .await
            .unwrap();
        let mut request = fixture(&temp.path().join("nas"));
        request.settings.shares[0].protocols.ftp.enabled = false;
        let options = test_options(&temp);
        let runner = FakeRunner::default();

        let result = apply_with_options(&request, &runner, &options, &configured_roots(&request))
            .await
            .unwrap();

        assert!(!result.services.contains(&"vsftpd.service".to_owned()));
        assert!(
            runner
                .calls
                .lock()
                .unwrap()
                .iter()
                .any(|(command, args, _)| {
                    command == "systemctl" && args == &["try-reload-or-restart", "vsftpd.service"]
                })
        );
    }

    #[tokio::test]
    async fn keeps_credentials_out_of_command_arguments() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("nas/media"))
            .await
            .unwrap();
        let mut request = fixture(&temp.path().join("nas"));
        request.settings.account.password = Some("top-secret".to_owned());
        let options = test_options(&temp);
        fs::create_dir_all(options.paths.htpasswd.parent().unwrap())
            .await
            .unwrap();
        fs::write(&options.paths.htpasswd, "fixture\n")
            .await
            .unwrap();
        let runner = FakeRunner::default();
        apply_with_options(&request, &runner, &options, &configured_roots(&request))
            .await
            .unwrap();
        let calls = runner.calls.lock().unwrap();
        assert!(
            calls
                .iter()
                .all(|(_, args, _)| !args.iter().any(|arg| arg.contains("top-secret")))
        );
        assert!(calls.iter().any(|(command, _, input)| {
            command == "smbpasswd"
                && input
                    .as_deref()
                    .is_some_and(|input| input.windows(10).any(|part| part == b"top-secret"))
        }));
    }

    #[tokio::test]
    async fn rejects_share_paths_that_escape_the_root() {
        let mut request = fixture(Path::new("/srv/nas"));
        request.settings.shares[0].path = "../../etc".into();
        assert!(
            resolve_shares(&request.settings, &configured_roots(&request))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn rejects_share_paths_that_resolve_outside_the_root() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("nas");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root).await.unwrap();
        fs::create_dir_all(&outside).await.unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        let mut request = fixture(&root);
        request.settings.shares[0].path = "escape".into();

        assert!(
            resolve_shares(&request.settings, &configured_roots(&request))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn rejects_share_paths_that_cannot_be_embedded_in_service_configs() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("nas");
        fs::create_dir_all(root.join("media\ninclude = /tmp/override"))
            .await
            .unwrap();
        let mut request = fixture(&root);
        request.settings.shares[0].path = PathBuf::from("media\ninclude = /tmp/override");
        let runner = FakeRunner::default();

        let error = apply_with_options(
            &request,
            &runner,
            &test_options(&temp),
            &configured_roots(&request),
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, crate::error::ErrorCode::Validation);
        assert!(runner.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn rejects_nfs_export_injection_in_allowed_cidrs() {
        let mut request = fixture(Path::new("/srv/nas"));
        request.settings.shares[0].protocols.nfs.allowed_cidrs =
            vec!["*(rw,no_root_squash) 0.0.0.0/0".to_owned()];

        assert_eq!(
            validate_request(&request).unwrap_err().code,
            crate::error::ErrorCode::Validation
        );
    }

    #[test]
    fn rejects_client_roots_that_do_not_match_hostd_configuration() {
        let request = fixture(Path::new("/"));
        let configured = vec![ConfiguredNasRoot {
            id: "primary".to_owned(),
            path: PathBuf::from("/srv/nas"),
        }];

        assert_eq!(
            validate_requested_roots(&request.roots, &configured)
                .unwrap_err()
                .code,
            crate::error::ErrorCode::Validation
        );
    }
}
