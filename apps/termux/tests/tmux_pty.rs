use std::path::PathBuf;
use std::time::Duration;

use nix::unistd::{Gid, Uid};
use sigmaos_termux::config::Account;
use sigmaos_termux::{pty, tmux::TmuxManager};
use tokio::time::timeout;

#[tokio::test]
async fn attaches_to_a_real_tmux_session_through_a_pty() {
    let directory = tempfile::tempdir().unwrap();
    let account = Account {
        name: std::env::var("USER").unwrap_or_else(|_| "sigmaos-test".to_owned()),
        uid: Uid::current().as_raw(),
        gid: Gid::current().as_raw(),
        home: directory.path().to_owned(),
        shell: PathBuf::from("/bin/sh"),
    };
    let manager = TmuxManager::new(directory.path().join("tmux.sock"), account, 4);
    if manager.ensure_available().await.is_err() {
        eprintln!("tmux is unavailable; skipping tmux PTY integration test");
        return;
    }

    let session = "sigmaos-integration";
    manager.ensure_session(session, true).await.unwrap();
    let mut process = pty::spawn(manager.attach_command(session), 120, 32).unwrap();
    pty::write_all(&process.master, b"printf 'termux-integration-ready\\n'\r")
        .await
        .unwrap();

    let output = timeout(Duration::from_secs(5), async {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        while !String::from_utf8_lossy(&output).contains("termux-integration-ready") {
            let count = pty::read_chunk(&process.master, &mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            output.extend_from_slice(&buffer[..count]);
        }
        output
    })
    .await
    .expect("timed out waiting for tmux PTY output");

    assert!(String::from_utf8_lossy(&output).contains("termux-integration-ready"));
    pty::resize(&process.master, 101, 37).unwrap();
    manager.resize(session, 101, 37).await.unwrap();
    pty::write_all(
        &process.master,
        b"printf 'termux-resize:'; stty size; printf ':done\\n'\r",
    )
    .await
    .unwrap();
    let resized_output = timeout(Duration::from_secs(5), async {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        while {
            let output = String::from_utf8_lossy(&output);
            !(output.contains("termux-resize:37 101") && output.contains(":done"))
        } {
            let count = pty::read_chunk(&process.master, &mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            output.extend_from_slice(&buffer[..count]);
        }
        output
    })
    .await
    .expect("timed out waiting for resized tmux PTY output");
    assert!(
        String::from_utf8_lossy(&resized_output).contains("termux-resize:37 101")
            && String::from_utf8_lossy(&resized_output).contains(":done"),
        "resized output: {:?}",
        String::from_utf8_lossy(&resized_output)
    );
    manager.destroy(session).await.unwrap();
    pty::terminate(&mut process.child).await;
}
