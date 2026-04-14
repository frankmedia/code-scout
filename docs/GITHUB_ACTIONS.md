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
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | Tag `v*` or manual | Full matrix: macOS (2 arch), Windows, Linux → draft release |

### Windows-only (Option A)

1. **Push workflows to GitHub** (requires token with `workflow` scope)

   If `git push` fails with *"refusing to allow an OAuth App to create or update workflow … without `workflow` scope"*:

   - Regenerate a [Personal Access Token (classic)](https://github.com/settings/tokens) with scopes: **`repo`**, **`workflow`**.
   - Or use **GitHub Desktop** / **SSH** with an account that can push workflow files.

   ```bash
   git push origin main
   ```

2. **Run the workflow**

   - Repo → **Actions** → **Build Windows** → **Run workflow** → Run.

3. **Artifacts**

   - When the job finishes, open **Releases** (or the run summary link).
   - A **draft** release is created with tag like `v0.2.1-windows-ci-<run_id>`.
   - Download the NSIS `.exe` / WiX `.msi` from the release assets.

**Costs (private repo, 2026):** Windows `windows-latest` is billed per minute; first Rust build is often ~8–15 min, faster with `rust-cache` on repeats. See [GitHub Actions billing](https://docs.github.com/billing/managing-billing-for-your-products/about-billing-for-github-actions).

**Unsigned builds:** SmartScreen may warn on first launch — **More info** → **Run anyway** until you add Windows code signing (e.g. Azure Trusted Signing).

**Updater:** The Windows-only workflow sets `includeUpdaterJson: false` so you do **not** need `TAURI_SIGNING_PRIVATE_KEY`.

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

## After pushing workflows: trigger Windows build

```bash
gh workflow run "Build Windows" --ref main
gh run watch --exit-status  # optional: wait until finished
```

Or use the **Actions** tab in the browser.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Push rejected (workflow scope) | PAT with **`workflow`** scope, or non-OAuth push path |
| `npm ci` fails on CI | Ensure `package-lock.json` is committed and in sync with `package.json` |
| `bun` not found on Windows CI | If the repo has `bun.lock`, `tauri-action` may pick Bun. Workflows set `tauriScript: npm run tauri:build` so npm is used. |
| Windows build missing WebView2 | `windows-latest` images include WebView2 runtime; if you see runtime errors, check Tauri docs for bundled vs. evergreen runtime |
