fn main() {
    println!("cargo:rerun-if-changed=../public/logo.svg");
    println!("cargo:rerun-if-changed=swift/scout-stt.swift");

    // Compile the bundled Swift speech-recognition helper on macOS.
    // The resulting binaries are placed in src-tauri/binaries/ so Tauri can
    // include them as externalBin sidecars (Contents/MacOS/scout-stt).
    //
    // We build *both* Apple Silicon and Intel slices. Common setups use an
    // x86_64-apple-darwin Rust toolchain (e.g. Homebrew under Rosetta) while
    // `tauri bundle` still expects `scout-stt-aarch64-apple-darwin` for the
    // arm64 .app — building only `CARGO_CFG_TARGET_ARCH` leaves the other
    // file missing and breaks bundling.
    #[cfg(target_os = "macos")]
    compile_swift_sidecars();

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn compile_swift_sidecars() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let src = format!("{manifest}/swift/scout-stt.swift");
    let bin_dir = format!("{manifest}/binaries");
    let macosx_ver =
        std::env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "13.0".to_string());

    if let Err(e) = std::fs::create_dir_all(&bin_dir) {
        eprintln!("cargo:warning=Could not create binaries dir: {e}");
        return;
    }

    // (Rust sidecar triple segment, swiftc -target CPU)
    let pairs = [("aarch64", "arm64"), ("x86_64", "x86_64")];

    for (rust_arch, swift_cpu) in pairs {
        let triple = format!("{rust_arch}-apple-darwin");
        let out = format!("{bin_dir}/scout-stt-{triple}");
        let swift_target = format!("{swift_cpu}-apple-macosx{macosx_ver}");

        if !needs_swift_rebuild(&src, &out) {
            continue;
        }

        eprintln!("cargo:warning=Compiling scout-stt for {triple}…");

        let status = std::process::Command::new("swiftc")
            .args([
                "-target",
                &swift_target,
                &src,
                "-framework",
                "Speech",
                "-framework",
                "Foundation",
                "-O",
                "-o",
                &out,
            ])
            .status();

        match status {
            Ok(s) if s.success() => {
                eprintln!("cargo:warning=scout-stt compiled → {out}");
                let _ = std::process::Command::new("codesign")
                    .args(["--sign", "-", "--force", &out])
                    .status();
            }
            Ok(s) => {
                eprintln!(
                    "cargo:warning=swiftc for {triple} exited with {s} — voice may be unavailable for this arch"
                );
            }
            Err(e) => {
                eprintln!("cargo:warning=swiftc not found ({e}) — voice transcription unavailable");
                return;
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn needs_swift_rebuild(src: &str, out: &str) -> bool {
    if !std::path::Path::new(out).exists() {
        return true;
    }
    let Ok(src_meta) = std::fs::metadata(src) else {
        return true;
    };
    let Ok(out_meta) = std::fs::metadata(out) else {
        return true;
    };
    let Ok(src_modified) = src_meta.modified() else {
        return true;
    };
    let Ok(out_modified) = out_meta.modified() else {
        return true;
    };
    out_modified < src_modified
}
