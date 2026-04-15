use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Result returned to the frontend after checking for updates.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub notes: String,
    pub download_url: String,
}

// ─── GitHub Releases (frankmedia/code-scout) ─────────────────────────────────

const GITHUB_REPO: &str = "frankmedia/code-scout";
const GITHUB_LATEST_API: &str = "https://api.github.com/repos/frankmedia/code-scout/releases/latest";

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GhAsset>,
}

fn normalize_version(s: &str) -> String {
    s.trim()
        .trim_start_matches(['v', 'V'])
        .trim()
        .to_string()
}

/// Semver-style compare on dot-separated integers: true if `remote` > `local`.
/// Supports any number of segments (e.g. 0.99.99).
fn is_newer(remote: &str, local: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        normalize_version(s)
            .split('.')
            .filter_map(|p| p.parse().ok())
            .collect()
    };
    let r = parse(remote);
    let l = parse(local);
    let n = r.len().max(l.len()).max(1);
    for i in 0..n {
        let rv = r.get(i).copied().unwrap_or(0);
        let lv = l.get(i).copied().unwrap_or(0);
        if rv > lv {
            return true;
        }
        if rv < lv {
            return false;
        }
    }
    false
}

/// In-app updater expects a `.tar.gz` containing `Code Scout.app` (see `pack-mac-updater-artifact.sh`).
fn pick_mac_updater_tar(assets: &[GhAsset]) -> Option<String> {
    let preferred = assets.iter().find(|a| {
        let n = a.name.to_lowercase();
        (n.contains("aarch64") || n.contains("arm64")) && n.ends_with(".app.tar.gz")
    });
    if let Some(a) = preferred {
        return Some(a.browser_download_url.clone());
    }
    assets
        .iter()
        .find(|a| a.name.to_lowercase().ends_with(".app.tar.gz"))
        .map(|a| a.browser_download_url.clone())
}

/// Check GitHub `releases/latest` for a newer macOS in-app update (`.app.tar.gz` asset).
pub async fn check_update(current_version: &str) -> Result<UpdateCheckResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = current_version;
        return Ok(UpdateCheckResult {
            update_available: false,
            current_version: current_version.to_string(),
            latest_version: String::new(),
            notes: String::new(),
            download_url: String::new(),
        });
    }

    #[cfg(target_os = "macos")]
    {
        check_update_macos(current_version).await
    }
}

#[cfg(target_os = "macos")]
async fn check_update_macos(current_version: &str) -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let api = std::env::var("CODE_SCOUT_RELEASES_API_URL").unwrap_or_else(|_| GITHUB_LATEST_API.to_string());

    let response = client
        .get(&api)
        .header(
            reqwest::header::USER_AGENT,
            format!("CodeScout/{} (+https://github.com/{})", current_version, GITHUB_REPO),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to reach GitHub releases: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub releases returned HTTP {} — check https://github.com/{}/releases",
            response.status(),
            GITHUB_REPO
        ));
    }

    let release: GhRelease = response
        .json()
        .await
        .map_err(|e| format!("Invalid GitHub release JSON: {}", e))?;

    let remote_raw = normalize_version(&release.tag_name);
    let notes = release.body.clone().unwrap_or_default();
    let download_url = pick_mac_updater_tar(&release.assets).unwrap_or_default();
    let update_available = is_newer(&remote_raw, current_version) && !download_url.is_empty();

    Ok(UpdateCheckResult {
        update_available,
        current_version: current_version.to_string(),
        latest_version: remote_raw,
        notes,
        download_url,
    })
}

/// Download the .tar.gz, extract it, replace the running app, and relaunch.
///
/// Steps:
/// 1. Download the archive to a temp directory
/// 2. Extract with `tar xzf`
/// 3. Move the current .app to trash (backup)
/// 4. Move the new .app into /Applications
/// 5. Clear quarantine attributes
/// 6. Relaunch
#[cfg(target_os = "macos")]
pub async fn download_and_install(download_url: &str) -> Result<String, String> {
    let tmp = std::env::temp_dir().join("codescout-update");
    // Clean previous attempts
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let archive_path = tmp.join("update.tar.gz");

    // ── 1. Download ──────────────────────────────────────────────────────────
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(download_url)
        .header(
            reqwest::header::USER_AGENT,
            format!("CodeScout-updater (+https://github.com/{})", GITHUB_REPO),
        )
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download returned HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    std::fs::write(&archive_path, &bytes)
        .map_err(|e| format!("Failed to save archive: {}", e))?;

    // ── 2. Extract ───────────────────────────────────────────────────────────
    let extract_dir = tmp.join("extracted");
    std::fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Failed to create extract dir: {}", e))?;

    let tar_ok = std::process::Command::new("tar")
        .args(["xzf", archive_path.to_str().unwrap_or("")])
        .current_dir(&extract_dir)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !tar_ok {
        return Err("Failed to extract update archive".to_string());
    }

    // ── 3. Find the .app bundle in the extracted files ───────────────────────
    let new_app = find_app_bundle(&extract_dir)
        .ok_or_else(|| "No .app bundle found in update archive".to_string())?;

    // ── 4. Replace the current app ───────────────────────────────────────────
    let install_path = PathBuf::from("/Applications/Code Scout.app");
    let backup_path = PathBuf::from("/Applications/Code Scout.app.backup");

    // Remove old backup if exists
    let _ = std::fs::remove_dir_all(&backup_path);

    // Move current app to backup
    if install_path.exists() {
        std::fs::rename(&install_path, &backup_path)
            .map_err(|e| format!("Failed to backup current app: {}", e))?;
    }

    // Move new app into place
    let mv_ok = std::process::Command::new("cp")
        .args([
            "-R",
            new_app.to_str().unwrap_or(""),
            install_path.to_str().unwrap_or(""),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !mv_ok {
        // Restore backup
        if backup_path.exists() {
            let _ = std::fs::rename(&backup_path, &install_path);
        }
        return Err("Failed to install update — restored previous version".to_string());
    }

    // ── 5. Clear quarantine ──────────────────────────────────────────────────
    let _ = std::process::Command::new("xattr")
        .args(["-cr", install_path.to_str().unwrap_or("")])
        .status();

    // ── 6. Clean up backup and temp ──────────────────────────────────────────
    let _ = std::fs::remove_dir_all(&backup_path);
    let _ = std::fs::remove_dir_all(&tmp);

    Ok("Update installed successfully".to_string())
}

#[cfg(not(target_os = "macos"))]
pub async fn download_and_install(_download_url: &str) -> Result<String, String> {
    Err("In-app install is only supported on macOS.".to_string())
}

/// Recursively find the first `.app` bundle in a directory.
fn find_app_bundle(dir: &std::path::Path) -> Option<PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".app") && path.is_dir() {
                return Some(path);
            }
            // Check one level deeper (tar might have a top-level folder)
            if path.is_dir() {
                if let Some(found) = find_app_bundle(&path) {
                    return Some(found);
                }
            }
        }
    }
    None
}
