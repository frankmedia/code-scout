# Code Scout

AI-powered coding assistant with multi-agent planning and execution. Built as a native desktop app with [Tauri](https://tauri.app/) + React + TypeScript.

**Website:** https://llmscout.co/code-scout

## Download

Get the latest pre-built macOS release from **[llmscout.co/code-scout](https://llmscout.co/code-scout)**. Windows and Linux builds are produced by the workflows in [`.github/workflows`](.github/workflows).

## Build from source

Requirements: [Bun](https://bun.sh/) (or Node 20+), [Rust](https://www.rust-lang.org/tools/install), and the platform toolchain Tauri requires ([macOS](https://v2.tauri.app/start/prerequisites/#macos) / [Windows](https://v2.tauri.app/start/prerequisites/#windows) / [Linux](https://v2.tauri.app/start/prerequisites/#linux)).

```bash
bun install
bun run tauri:dev      # dev build with hot reload
bun run tauri:build    # production build
```

The web build is served by Vite on `http://localhost:8080`; Tauri loads it into a native window.

## Project layout

- `src/` — React frontend (pages, components, stores, services)
- `src-tauri/` — Rust backend (commands, file system, terminal, capabilities)
- `scripts/` — release, signing, and notarization scripts
- `docs/` — build and CI notes
- `waitlist-api/` — small Node service for the public waitlist

## Support the project

If Code Scout is useful to you, you can [buy me a coffee ☕](https://buymeacoffee.com/frankvitet8). It keeps the lights on and the builds shipping.

## License

Code Scout is released under the [PolyForm Noncommercial License 1.0.0](LICENSE).

This is a **source-available, non-commercial** license — you may use, modify, and share the software freely for personal, research, educational, and other non-commercial purposes. Commercial use requires a separate license. Contact via [llmscout.co/code-scout](https://llmscout.co/code-scout) for commercial licensing.
