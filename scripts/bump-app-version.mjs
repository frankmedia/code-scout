#!/usr/bin/env node
/**
 * Sync app version across the repo (single source of truth after this runs).
 *
 * Modes:
 *   (no args)           — patch +1 from current src-tauri/tauri.conf.json (0.1.3 → 0.1.4, …)
 *   X.Y.Z               — set exact version everywhere
 *   --set X.Y.Z         — same as X.Y.Z
 *
 * Updates:
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml (app crate version line)
 *   - package.json
 *   - public/code-scout/download/version.json (version + GitHub release asset URL)
 *
 * Usage:
 *   node scripts/bump-app-version.mjs
 *   node scripts/bump-app-version.mjs 0.1.20
 *   node scripts/bump-app-version.mjs --set 0.1.20
 *   CS_RELEASE_REPO=owner/repo node scripts/bump-app-version.mjs   # default frankmedia/code-scout
 *
 *   npm run version:bump
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const taPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const pkgPath = path.join(root, 'package.json');
const versionJsonPath = path.join(root, 'public', 'code-scout', 'download', 'version.json');
const MAX = 99;

const SEMVER = /^\d+\.\d+\.\d+$/;

function bumpTriple(s) {
  const parts = s
    .trim()
    .split('.')
    .map((p) => parseInt(p, 10));
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid version string: ${JSON.stringify(s)}`);
  }
  while (parts.length < 3) parts.push(0);
  let x = parts[0];
  let y = parts[1];
  let z = parts[2];
  z += 1;
  if (z > MAX) {
    z = 0;
    y += 1;
  }
  if (y > MAX) {
    y = 0;
    x += 1;
  }
  if (x > MAX) {
    throw new Error(`Version would exceed ${MAX}.${MAX}.${MAX} — bump major scheme manually.`);
  }
  return `${x}.${y}.${z}`;
}

function usage(code = 1) {
  console.error(`Usage:
  node scripts/bump-app-version.mjs              # patch bump from tauri.conf.json
  node scripts/bump-app-version.mjs X.Y.Z       # set exact version
  node scripts/bump-app-version.mjs --set X.Y.Z # same

Env: CS_RELEASE_REPO=owner/repo (default frankmedia/code-scout) — used for version.json download URL.`);
  process.exit(code);
}

const argv = process.argv.slice(2);
let newV;
let mode = 'patch';

if (argv.length === 0) {
  mode = 'patch';
} else if (argv[0] === '--set') {
  if (!argv[1] || !SEMVER.test(argv[1])) usage(1);
  newV = argv[1];
  mode = 'set';
} else if (argv.length === 1 && SEMVER.test(argv[0])) {
  newV = argv[0];
  mode = 'set';
} else if (argv[0] === '-h' || argv[0] === '--help') {
  usage(0);
} else {
  usage(1);
}

const ta = JSON.parse(fs.readFileSync(taPath, 'utf8'));
const oldV = ta.version;
if (typeof oldV !== 'string') throw new Error('tauri.conf.json missing string "version"');

if (mode === 'patch') {
  newV = bumpTriple(oldV);
}

if (!SEMVER.test(newV)) throw new Error(`Invalid target version: ${JSON.stringify(newV)}`);

ta.version = newV;
fs.writeFileSync(taPath, JSON.stringify(ta, null, 2) + '\n');

let cargo = fs.readFileSync(cargoPath, 'utf8');
if (!/^version = "/m.test(cargo)) {
  throw new Error('Cargo.toml: expected a line matching /^version = "/');
}
cargo = cargo.replace(/^version = "[^"]*"/m, `version = "${newV}"`);
fs.writeFileSync(cargoPath, cargo);

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = newV;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const repo = (process.env.CS_RELEASE_REPO || 'frankmedia/code-scout').replace(/^\/+|\/+$/g, '');
const url = `https://github.com/${repo}/releases/download/v${newV}/Code-Scout_${newV}_aarch64.app.tar.gz`;

let notes =
  'Website mirror — the desktop app checks GitHub releases/latest (see updater.rs).';
try {
  const prev = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
  if (typeof prev.notes === 'string' && prev.notes.trim()) notes = prev.notes;
} catch {
  /* keep default */
}

fs.writeFileSync(
  versionJsonPath,
  JSON.stringify({ version: newV, url, notes }, null, 2) + '\n',
);

const label = mode === 'patch' ? 'Version bump' : 'Version set';
console.log(`${label}: ${oldV} → ${newV}`);
console.log(`  ${path.relative(root, taPath)}`);
console.log(`  ${path.relative(root, cargoPath)}`);
console.log(`  ${path.relative(root, pkgPath)}`);
console.log(`  ${path.relative(root, versionJsonPath)}`);
console.log(`  download URL: ${url}`);
