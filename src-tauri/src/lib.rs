use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::Path;

mod updater;

// ─── File tree types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub content: Option<String>,
    pub language: Option<String>,
    pub children: Option<Vec<FileEntry>>,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", ".next", "dist", "build", ".cache",
    "__pycache__", ".turbo", "coverage", ".nuxt", ".output", "out",
    "target", ".DS_Store",
];
const MAX_FILES: usize = 5000;
/// Deeper trees (e.g. PHP / legacy repos) still need children past depth 8.
const MAX_DEPTH: usize = 16;
const MAX_FILE_SIZE: u64 = 2_000_000; // 2 MB

fn detect_lang(filename: &str) -> &'static str {
    match filename.rsplit('.').next().unwrap_or("") {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "css"        => "css",
        "scss"       => "scss",
        "html"       => "html",
        "json"       => "json",
        "md"         => "markdown",
        "py"         => "python",
        "rs"         => "rust",
        "go"         => "go",
        "java"       => "java",
        "yml" | "yaml" => "yaml",
        "toml"       => "toml",
        "sh"         => "shell",
        _            => "plaintext",
    }
}

fn read_dir_recursive(
    dir: &Path,
    base: &str,
    depth: usize,
    counter: &mut usize,
) -> Vec<FileEntry> {
    // Never bail out early just because the file budget is exhausted — that made
    // sibling folders look "stuck open" with no children. We still list dirs and
    // skip files once MAX_FILES entries are collected.
    if depth > MAX_DEPTH {
        return vec![];
    }

    let read = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let mut raw: Vec<(String, std::path::PathBuf, bool)> = Vec::new();

    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".env" && name != ".gitignore" && name != ".codescout" && name != ".codescout_web" {
            continue;
        }
        let path = entry.path();
        let is_dir = path.is_dir();
        if is_dir && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        raw.push((name, path, is_dir));
    }

    // Folders first, then alphabetical
    raw.sort_by(|a, b| match (a.2, b.2) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.0.to_lowercase().cmp(&b.0.to_lowercase()),
    });

    let mut nodes: Vec<FileEntry> = Vec::new();

    for (name, path, is_dir) in raw {
        let rel_path = if base.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", base, name)
        };

        if is_dir {
            let children = read_dir_recursive(&path, &rel_path, depth + 1, counter);
            nodes.push(FileEntry {
                name,
                path: rel_path,
                entry_type: "folder".to_string(),
                content: None,
                language: None,
                children: Some(children),
            });
        } else {
            if *counter >= MAX_FILES {
                continue;
            }
            *counter += 1;

            let size = std::fs::metadata(&path)
                .map(|m| m.len())
                .unwrap_or(u64::MAX);

            let content = if size < MAX_FILE_SIZE {
                std::fs::read_to_string(&path)
                    .unwrap_or_else(|_| "// Binary or unreadable file".to_string())
            } else {
                format!("// File too large ({} MB)", size / 1_000_000)
            };

            nodes.push(FileEntry {
                name: name.clone(),
                path: rel_path,
                entry_type: "file".to_string(),
                content: Some(content),
                language: Some(detect_lang(&name).to_string()),
                children: None,
            });
        }
    }

    nodes
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Read an entire project directory recursively, returning a FileNode tree.
#[tauri::command]
fn read_project_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let mut counter = 0usize;
    Ok(read_dir_recursive(dir, "", 0, &mut counter))
}

/// Resolve a program name to its absolute path, checking common Node.js locations.
fn resolve_program(program: &str) -> String {
    if program == "node" || program == "npm" || program == "npx" {
        // On Windows, executables have .cmd/.exe extensions
        #[cfg(target_os = "windows")]
        let suffixes: &[&str] = if program == "node" { &[".exe", ""] } else { &[".cmd", ".exe", ""] };
        #[cfg(target_os = "windows")]
        {
            let appdata = std::env::var("APPDATA").unwrap_or_default();
            let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();
            let programfiles = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
            let userprofile = std::env::var("USERPROFILE").unwrap_or_default();

            // nvm-windows: %APPDATA%\nvm\<version>\node.exe
            let nvm_base = format!("{}\\nvm", appdata);
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .filter(|n| n.starts_with('v') || n.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
                    .collect();
                versions.sort();
                if let Some(ver) = versions.last() {
                    for sfx in suffixes {
                        let bin = format!("{}\\{}\\{}{}", nvm_base, ver, program, sfx);
                        if Path::new(&bin).exists() { return bin; }
                    }
                }
            }

            // fnm on Windows: %LOCALAPPDATA%\fnm_multishells\<...>
            // Standard locations
            let win_candidates = vec![
                format!("{}\\nodejs", programfiles),
                format!("{}\\fnm", localappdata),
                format!("{}\\volta\\bin", userprofile),
                format!("{}\\npm", appdata),
            ];
            for base in &win_candidates {
                for sfx in suffixes {
                    let bin = format!("{}\\{}{}", base, program, sfx);
                    if Path::new(&bin).exists() { return bin; }
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let home = std::env::var("HOME").unwrap_or_default();

            // nvm (most common on macOS/Linux)
            let nvm_base = format!("{}/.nvm/versions/node", home);
            if let Ok(entries) = std::fs::read_dir(&nvm_base) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect();
                versions.sort();
                if let Some(ver) = versions.last() {
                    let bin = format!("{}/{}/bin/{}", nvm_base, ver, program);
                    if Path::new(&bin).exists() { return bin; }
                }
            }

            // fnm (fast node manager)
            let fnm_base = format!("{}/.local/share/fnm/node-versions", home);
            if let Ok(entries) = std::fs::read_dir(&fnm_base) {
                let mut versions: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect();
                versions.sort();
                if let Some(ver) = versions.last() {
                    let bin = format!("{}/{}/installation/bin/{}", fnm_base, ver, program);
                    if Path::new(&bin).exists() { return bin; }
                }
            }

            // Standard locations (Homebrew, system, volta, etc.)
            for loc in &[
                format!("/usr/local/bin/{}", program),
                format!("/opt/homebrew/bin/{}", program),
                format!("/usr/bin/{}", program),
                format!("{}/.volta/bin/{}", home, program),
                format!("{}/.local/bin/{}", home, program),
            ] {
                if Path::new(loc).exists() { return loc.clone(); }
            }
        }

        program.to_string()
    } else {
        program.to_string()
    }
}

/// Get the bin directory for the resolved node, so npm/npx can find each other.
fn get_node_bin_dir() -> Option<String> {
    let resolved = resolve_program("node");
    if resolved == "node" || resolved == "node.exe" { return None; }
    Path::new(&resolved).parent().map(|p| p.to_string_lossy().to_string())
}

/// PATH separator for the current platform.
#[cfg(target_os = "windows")]
const PATH_SEP: &str = ";";
#[cfg(not(target_os = "windows"))]
const PATH_SEP: &str = ":";

/// Spawn a background process (node, etc.) and return its PID.
#[tauri::command]
fn spawn_background(program: String, args: Vec<String>, cwd: Option<String>, env: Option<std::collections::HashMap<String, String>>) -> Result<u32, String> {
    use std::process::{Command as StdCommand, Stdio};

    let resolved = resolve_program(&program);

    // Log to file for diagnostics, discard stdin
    let log_path = std::env::temp_dir().join("codescout-spawn.log");
    let log_file = std::fs::File::create(&log_path)
        .map_err(|e| format!("Failed to create log file: {}", e))?;
    let log_err = log_file.try_clone()
        .map_err(|e| format!("Failed to clone log file: {}", e))?;

    let mut cmd = StdCommand::new(&resolved);
    cmd.args(&args)
        .stdout(log_file)
        .stderr(log_err)
        .stdin(Stdio::null());

    // Ensure node/npm/npx can find each other by adding node's bin dir to PATH
    if let Some(node_bin) = get_node_bin_dir() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{}{}{}", node_bin, PATH_SEP, current_path));
    }

    if let Some(dir) = &cwd {
        if Path::new(dir).exists() {
            cmd.current_dir(dir);
        }
    }
    if let Some(env_map) = env {
        for (k, v) in env_map {
            cmd.env(k, v);
        }
    }

    let child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn '{}' (resolved: '{}'): {}", program, resolved, e))?;

    Ok(child.id())
}

/// Run a command synchronously and return its stdout+stderr. Used for npm install, etc.
/// Reuses the same executable resolution as spawn_background.
#[tauri::command]
async fn run_command(program: String, args: Vec<String>, cwd: Option<String>, env: Option<std::collections::HashMap<String, String>>) -> Result<String, String> {
    use std::process::{Command as StdCommand, Stdio};

    let resolved = resolve_program(&program);

    let mut cmd = StdCommand::new(&resolved);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    // Ensure node/npm/npx can find each other by adding node's bin dir to PATH
    if let Some(node_bin) = get_node_bin_dir() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{}{}{}", node_bin, PATH_SEP, current_path));
    }

    if let Some(dir) = &cwd {
        if Path::new(dir).exists() {
            cmd.current_dir(dir);
        }
    }
    if let Some(env_map) = env {
        for (k, v) in env_map {
            cmd.env(k, v);
        }
    }

    let output = cmd.output()
        .map_err(|e| format!("Failed to run '{}' (resolved: '{}'): {}", program, resolved, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("Command failed (exit {}): {}{}", output.status.code().unwrap_or(-1), stderr, stdout));
    }

    Ok(format!("{}{}", stdout, stderr))
}

/// Write text content to any file path, creating parent directories as needed.
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dirs: {}", e))?;
    }
    std::fs::write(p, content)
        .map_err(|e| format!("Failed to write file {}: {}", path, e))
}

/// Read text content from a file.
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file {}: {}", path, e))
}

/// Write binary content (base64-encoded) to any file path, creating parent dirs.
#[tauri::command]
fn write_binary_file(path: String, data_base64: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create dirs: {}", e))?;
    }
    std::fs::write(p, bytes)
        .map_err(|e| format!("Failed to write binary file {}: {}", path, e))
}

/// Create a directory (and all parents).
#[tauri::command]
fn create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create dir {}: {}", path, e))
}

/// Return the user's login shell binary name (e.g. "zsh", "bash").
/// Reads $SHELL and strips the directory prefix so the result matches
/// the `name` entries in tauri.conf.json's shell scope.
#[tauri::command]
fn get_user_shell() -> String {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // Extract just the binary name: "/bin/zsh" → "zsh"
    shell
        .rsplit('/')
        .next()
        .unwrap_or("zsh")
        .to_string()
}

/// GET a URL; returns status + body (bypasses browser CORS). Used for LAN discovery and llama-server probes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
async fn http_request(url: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "text/html,application/json,*/*;q=0.8")
        .header(reqwest::header::USER_AGENT, "CodeScout/1.0 (Desktop App)")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();

    Ok(HttpResponse { status, body })
}

/// Transcribe audio using macOS SFSpeechRecognizer (Apple native, free, on-device).
///
/// The `scout-stt` binary is compiled from Swift source during `cargo build`
/// (see build.rs) and bundled inside the app at `Contents/MacOS/scout-stt`.
/// Because it lives inside the app bundle it shares Code Scout's TCC identity,
/// so the speech-recognition authorization dialog correctly says "Code Scout".
///
/// Accepts base64-encoded audio and the file extension ("m4a" or "webm").
/// WebM is converted to WAV via ffmpeg if available; m4a/mp4 is used directly.
#[tauri::command]
async fn transcribe_audio_native(
    app: tauri::AppHandle,
    audio_base64: String,
    ext: String,
) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, &audio_base64, &ext);
        return Err(
            "ERR:not_supported:Native speech-to-text (scout-stt) is only available on macOS."
                .to_string(),
        );
    }

    #[cfg(target_os = "macos")]
    {
        transcribe_audio_native_macos(app, audio_base64, ext).await
    }
}

#[cfg(target_os = "macos")]
async fn transcribe_audio_native_macos(
    app: tauri::AppHandle,
    audio_base64: String,
    ext: String,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;

    // ── 1. Decode base64 → raw bytes ────────────────────────────────────────
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("ERR:base64:{}", e))?;

    // ── 2. Write to temp file ────────────────────────────────────────────────
    let ext = if ext.is_empty() { "webm".to_string() } else { ext.to_lowercase() };
    let tmp = std::env::temp_dir();
    let audio_path = tmp.join(format!("scout_voice.{}", ext));
    std::fs::write(&audio_path, &bytes)
        .map_err(|e| format!("ERR:write:{}", e))?;

    // ── 3. Convert WebM → WAV if needed (SFSpeechRecognizer needs m4a/wav) ──
    let input_path = if ext == "webm" {
        let wav = tmp.join("scout_voice.wav");
        let ok = std::process::Command::new("ffmpeg")
            .args(["-y", "-loglevel", "quiet",
                   "-i", audio_path.to_str().unwrap_or(""),
                   "-ar", "16000", "-ac", "1", "-f", "wav",
                   wav.to_str().unwrap_or("")])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok && wav.exists() { wav } else { audio_path.clone() }
    } else {
        audio_path.clone()
    };

    let audio_arg = input_path.to_str()
        .ok_or_else(|| "ERR:path_encoding".to_string())?
        .to_string();

    // ── 4. Spawn the bundled scout-stt sidecar ───────────────────────────────
    // The sidecar is placed in Contents/MacOS/ by Tauri at bundle time and
    // compiled by build.rs during cargo build.
    let sidecar = app.shell()
        .sidecar("scout-stt")
        .map_err(|e| format!("ERR:sidecar_not_found:{}", e))?
        .args([audio_arg]);

    let out = sidecar
        .output()
        .await
        .map_err(|e| format!("ERR:spawn:{}", e))?;

    // ── 5. Parse output ──────────────────────────────────────────────────────
    let stderr = String::from_utf8_lossy(&out.stderr);
    let first_err = stderr.lines().find(|l| l.starts_with("ERR:")).unwrap_or("").to_string();

    if !first_err.is_empty() {
        return Err(first_err);
    }
    if !out.status.success() {
        return Err(format!("ERR:sidecar_exit:{}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

// ─── Playwright global browser tool ───────────────────────────────────────────

/// Ensures playwright-core + Chromium are installed in ~/.codescout/tools/.
/// Safe to call on every browse_web invocation — exits immediately if already ready.
#[tauri::command]
async fn ensure_playwright() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("ERR:no_home_dir")?;
    let tools_dir = home.join(".codescout").join("tools");
    std::fs::create_dir_all(&tools_dir)
        .map_err(|e| format!("ERR:mkdir:{}", e))?;

    let playwright_dir = tools_dir.join("node_modules").join("playwright-core");
    let bridge_path = tools_dir.join("scout-browser.cjs");

    // Write / refresh the bridge script every time (it's tiny)
    let bridge_script = r#"
const { chromium } = require('playwright-core');
const [url, actionsJson] = process.argv.slice(2);
const actions = actionsJson ? JSON.parse(actionsJson) : [];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  for (const a of actions) {
    if (a.type === 'click') await page.click(a.selector).catch(() => {});
    if (a.type === 'wait') await page.waitForTimeout(a.ms || 1000);
  }
  const title = await page.title();
  const content = await page.evaluate(() => document.body.innerText);
  await browser.close();
  process.stdout.write(JSON.stringify({ title, content: content.slice(0, 12000), url: page.url() }));
})().catch(e => { process.stderr.write(e.message); process.exit(1); });
"#;
    std::fs::write(&bridge_path, bridge_script.trim_start())
        .map_err(|e| format!("ERR:write_bridge:{}", e))?;

    if playwright_dir.exists() {
        return Ok("ready".to_string());
    }

    // Install playwright-core (no browser binaries yet)
    let npm_out = std::process::Command::new("npm")
        .args(["install", "playwright-core"])
        .current_dir(&tools_dir)
        .output()
        .map_err(|e| format!("ERR:npm:{}", e))?;

    if !npm_out.status.success() {
        return Err(format!(
            "ERR:npm_install:{}",
            String::from_utf8_lossy(&npm_out.stderr).chars().take(400).collect::<String>()
        ));
    }

    // Install Chromium browser binary
    let pw_out = std::process::Command::new("npx")
        .args(["playwright", "install", "chromium"])
        .current_dir(&tools_dir)
        .env("PLAYWRIGHT_BROWSERS_PATH", tools_dir.join("browsers").to_str().unwrap_or(""))
        .output()
        .map_err(|e| format!("ERR:npx:{}", e))?;

    if !pw_out.status.success() {
        return Err(format!(
            "ERR:install_chromium:{}",
            String::from_utf8_lossy(&pw_out.stderr).chars().take(400).collect::<String>()
        ));
    }

    Ok("installed".to_string())
}

/// Navigate a real headless Chromium browser to `url` and return
/// `{ title, content, url }` as a JSON string.  Use instead of `fetch_url`
/// for any page that uses JavaScript (SPAs, docs sites, GitHub, etc.).
#[tauri::command]
async fn browse_web(url: String, actions_json: Option<String>) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("ERR:no_home_dir")?;
    let tools_dir = home.join(".codescout").join("tools");
    let bridge = tools_dir.join("scout-browser.cjs");

    // Install on first use
    ensure_playwright().await?;

    let browsers_path = tools_dir.join("browsers");

    let mut cmd = std::process::Command::new("node");
    cmd.arg(bridge.to_str().unwrap_or(""))
       .arg(&url)
       .env("PLAYWRIGHT_BROWSERS_PATH", browsers_path.to_str().unwrap_or(""));

    if let Some(ref aj) = actions_json {
        cmd.arg(aj);
    }

    let out = cmd.output().map_err(|e| format!("ERR:node:{}", e))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("ERR:browser:{}", err.chars().take(300).collect::<String>()));
    }

    let json = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if json.is_empty() {
        return Err("ERR:empty_response".to_string());
    }
    Ok(json)
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<updater::UpdateCheckResult, String> {
    let v = app.package_info().version.to_string();
    updater::check_update(&v).await
}

#[tauri::command]
async fn download_and_install_update(download_url: String) -> Result<String, String> {
    updater::download_and_install(&download_url).await
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_project_dir,
            read_file_text,
            spawn_background,
            run_command,
            write_file,
            write_binary_file,
            create_dir,
            http_request,
            get_user_shell,
            transcribe_audio_native,
            ensure_playwright,
            browse_web,
            check_for_update,
            download_and_install_update,
            relaunch_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
