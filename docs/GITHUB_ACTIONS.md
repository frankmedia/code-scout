# GitHub Actions — Code Scout

## If `git push` is rejected (workflow scope)

GitHub blocks pushes that add or change workflow files unless the credential has the **`workflow`** scope.

1. **GitHub CLI (recommended)** — refresh token, then push again:

   ```bash
   gh auth refresh -h github.com -s workflow -s repo
   git push origin main
   ```

   Complete the browser / device login when prompted.

2. **Personal Access Token** — create a [fine-grained or classic PAT](https://github.com/settings/tokens) with **`Contents: Read and write`** and **workflow file** permissions (classic: enable **`workflow`**).

3. **Web UI** — paste the YAML from [`.github/workflows/build-windows.yml`](../.github/workflows/build-windows.yml) using **Add file** in the repo (no local `git push` of workflows needed).

Until the push succeeds, Actions will not see the new workflow.

---

## Workflows

| File | Trigger | Purpose |
|------|---------|---------|
| [`.github/workflows/build-windows.yml`](../.github/workflows/build-windows.yml) | **Manual** (`workflow_dispatch`) | Windows-only unsigned build → draft GitHub Release |
| [`.github/workflows/build-macos.yml`](../.github/workflows/build-macos.yml) | **Manual** (`workflow_dispatch`) | macOS-only unsigned build → draft GitHub Release |
| [`.github/workflows/build-linux.yml`](../.github/workflows/build-linux.yml) | **Manual** (`workflow_dispatch`) | Linux-only unsigned build → draft GitHub Release |
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Tag `v*` or manual | Full matrix: macOS (2 arch), Windows, Linux → draft release |

### Manual single-platform builds (unsigned)

1. **Push workflows to GitHub** (requires token with `workflow` scope)

   If `git push` fails with *"refusing to allow an OAuth App to create or update workflow … without `workflow` scope"*:

   - Regenerate a [Personal Access Token (classic)](https://github.com/settings/tokens) with scopes: **`repo`**, **`workflow`**.
   - Or use **GitHub Desktop** / **SSH** with an account that can push workflow files.

   ```bash
   git push origin main
   ```

2. **Run one of the workflows**

   - Repo → **Actions** → **Build Windows** / **Build macOS** / **Build Linux** → **Run workflow** → Run.

3. **Artifacts**

   - When the job finishes, open **Releases** (or the run summary link).
   - A **draft** release is created with tag like `v0.2.1-<platform>-ci-<run_id>`.
   - Download platform-specific assets from the release.

**Costs (private repo, 2026):** Hosted runners are billed per minute. First Rust builds are often ~8–20 min depending on platform and cache warmup. See [GitHub Actions billing](https://docs.github.com/billing/managing-billing-for-your-products/about-billing-for-github-actions).

**Unsigned builds:** Windows SmartScreen and macOS Gatekeeper may warn on first launch.

**Updater:** Single-platform workflows set `includeUpdaterJson: false` so you do **not** need `TAURI_SIGNING_PRIVATE_KEY`.

---

## Full cross-platform release (`release.yml`)

Triggered by pushing a version tag (after workflows exist on GitHub and `package.json` / Tauri versions match the tag):

```bash
git tag v0.2.1
git push origin v0.2.1
```

Requires repository **Secrets** (Settings → Secrets and variables → Actions) for macOS signing/notarization when you want signed mac builds in CI.

### Secrets checklist (macOS + optional updater)

| Secret | Purpose |
|--------|---------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` of **Developer ID Application** cert |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | Apple ID email (for notarization API) |
| `APPLE_PASSWORD` | [App-specific password](https://appleid.apple.com) (not your Apple ID login password) |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Only if you enable the Tauri updater / signed update JSON |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Matches the key above |

Windows and Linux jobs do not require Apple secrets. macOS jobs will fail until these are set.

---

## After pushing workflows: trigger builds

```bash
gh workflow run "Build Windows" --ref main
gh workflow run "Build macOS" --ref main
gh workflow run "Build Linux" --ref main
gh run watch --exit-status  # optional: wait until finished
```

Or use the **Actions** tab in the browser.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Push rejected (workflow scope) | PAT with **`workflow`** scope, or non-OAuth push path |
| `npm ci` fails on CI | Ensure `package-lock.json` is committed and in sync with `package.json` |
| `bun` not found on Windows CI | If the repo has `bun.lock`, `tauri-action` may pick Bun. Workflows set `tauriScript: npm run tauri` (must not include `build`; the action appends it). |
| Tauri build missing icons | Ensure `src-tauri/icons/icon.ico` (and related assets) are committed. Do not rely on `tauri:icon` in CI on Windows — `generate-app-icon.mjs` uses `npx` in a way that can fail on Windows runners. |
| Linux build fails looking for `scout-stt-*linux*` sidecar | `src-tauri/tauri.linux.conf.json` sets `bundle.externalBin: []` (the STT sidecar is macOS-only). |
| Windows build missing WebView2 | `windows-latest` images include WebView2 runtime; if you see runtime errors, check Tauri docs for bundled vs. evergreen runtime |
