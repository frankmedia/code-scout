# Code Scout — Project Skills
> Auto-generated on 2026-04-15T16:51:07.111Z — edit the "User Notes" section below to add permanent tips

# code-scout

## Stack
- Language: TypeScript
- File extensions: .ts (112), .tsx (89), .sh (5), .mjs (4)
- Framework: React + Vite
- Package manager: npm
- Styling: TailwindCSS

## Structure
Top-level: .codescout, docs, public, scripts, src, src-tauri, tests, waitlist-api
Entry points: src/main.tsx, src/App.tsx, index.html, src/main.rs, src/lib.rs
Important files: README.md, .gitignore, package.json, tsconfig.json, vite.config.ts, tailwind.config.ts, postcss.config.js, eslint.config.js, Cargo.toml, Cargo.lock, build.rs

## File tree (use EXACTLY these paths)
.codescout
.codescout/context.md
.codescout/project.json
.codescout/skills.md
docs
docs/GITHUB_ACTIONS.md
public
public/code-scout
public/code-scout/download
public/code-scout/download/Code Scout_0.1.9_aarch64.dmg
public/code-scout/download/Code-Scout_0.1.9_aarch64.app.tar.gz
public/code-scout/download/version.json
public/favicon.ico
public/logo.svg
public/placeholder.svg
public/robots.txt
scripts
scripts/migrations
scripts/migrations/codescout_waitlist.sql
scripts/build-macos-bundle.sh
scripts/build-signed-notarized.sh
scripts/generate-app-icon.mjs
scripts/pack-mac-updater-artifact.sh
scripts/publish-mac-downloads.sh
scripts/release-mac.sh
scripts/smoke-bridge-apis.mjs
src
src/components
src/components/auth
src/components/auth/LoginGate.tsx
src/components/auth/PreAuthScreens.tsx
src/components/marketing
src/components/marketing/CodeScoutScreenshotGallery.tsx
src/components/ui
src/components/ui/accordion.tsx
src/components/ui/alert-dialog.tsx
src/components/ui/alert.tsx
src/components/ui/aspect-ratio.tsx
src/components/ui/avatar.tsx
src/components/ui/badge.tsx
src/components/ui/breadcrumb.tsx
src/components/ui/button.tsx
src/components/ui/calendar.tsx
src/components/ui/card.tsx
src/components/ui/carousel.tsx
src/components/ui/chart.tsx
src/components/ui/checkbox.tsx
src/components/ui/collapsible.tsx
src/components/ui/command.tsx
src/components/ui/context-menu.tsx
src/components/ui/dialog.tsx
src/components/ui/drawer.tsx
src/components/ui/dropdown-menu.tsx
src/components/ui/form.tsx
src/components/ui/hover-card.tsx
src/components/ui/input-otp.tsx
src/components/ui/input.tsx
src/components/ui/label.tsx
src/components/ui/menubar.tsx
src/components/ui/navigation-menu.tsx
... and 294 more files

## Commands
- dev: `vite`
- build: `vite build`
- test: `vitest run`
- lint: `eslint .`

## Architecture
- React + Vite detected
- Entry: src/main.tsx

## Conventions
- Components: Typed functional components
- Use Tailwind utility classes
- Prefer functional components

## IMPORTANT
- ALL file paths MUST match the file tree above exactly. 
- ALWAYS use the correct file extensions. Check existing files before creating new ones.
- Check entry points and important files to understand what exists before modifying.
- Use the project's package manager and build tools (npm).


## User Notes
<!-- Add project-specific tips here. This section is preserved across re-indexes. -->
<!-- Example: "Always use pnpm. tsx is available. Playwright is installed globally." -->