#!/usr/bin/env node
/**
 * Bump app version for the next release: patch +1 with carry (each segment 0..99).
 *
 * Examples: 0.1.0 → 0.1.1 → … → 0.1.99 → 0.2.0 → … → 0.99.99 → 1.0.0
 *
 * Updates:
 *   - src-tauri/tauri.conf.json  ("version")
 *   - src-tauri/Cargo.toml       (package version)
 *   - package.json               ("version", for CI / Linux bundle names)
 *
 * Usage: node scripts/bump-app-version.mjs
 *        npm run version:bump
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const taPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const pkgPath = path.join(root, 'package.json');
const MAX = 99;

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

const ta = JSON.parse(fs.readFileSync(taPath, 'utf8'));
const oldV = ta.version;
if (typeof oldV !== 'string') throw new Error('tauri.conf.json missing string "version"');
const newV = bumpTriple(oldV);
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

console.log(`Version bump: ${oldV} → ${newV}`);
console.log(`  ${path.relative(root, taPath)}`);
console.log(`  ${path.relative(root, cargoPath)}`);
console.log(`  ${path.relative(root, pkgPath)}`);
