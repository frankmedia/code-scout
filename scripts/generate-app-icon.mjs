/**
 * Builds a 1024² master: white squircle plate (transparent outside) + centered logo on top.
 * Avoids `dest-in` masking — that was wiping the glyph and left a blank white dock tile.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const source = join(root, 'public', 'logo.svg');
const outDir = join(root, 'src-tauri', 'icons');

const SIZE = 1024;
/** White squircle does not edge-to-edge — inset ~7% each side so Dock tile matches system app scale. */
const PLATE_SCALE = 0.86;
const PLATE = Math.round(SIZE * PLATE_SCALE);
const PLATE_MARGIN = Math.round((SIZE - PLATE) / 2);
/** 22.37% is the old rect template; macOS Dock squircles read rounder — bump radius for a closer match. */
const PLATE_RX = Math.round(PLATE * 0.29);
/** Was 0.44 of canvas; +20% → ~0.528 (glyph reads larger inside the plate). */
const LOGO_MAX = Math.round(SIZE * 0.44 * 1.2);

if (!existsSync(source)) {
  console.error('Missing', source);
  process.exit(1);
}

/** Inset rounded white plate; transparent margin around it shrinks visual “box” vs full-bleed icons. */
const plateSvg = `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${PLATE_MARGIN}" y="${PLATE_MARGIN}" width="${PLATE}" height="${PLATE}" rx="${PLATE_RX}" ry="${PLATE_RX}" fill="#ffffff"/>
</svg>`;

const tmpMaster = join(tmpdir(), `code-scout-icon-${Date.now()}.png`);

const plateBuf = await sharp(Buffer.from(plateSvg))
  .resize(SIZE, SIZE)
  .png()
  .toBuffer();

const logoBuf = await sharp(source, { density: 300 })
  .resize(LOGO_MAX, LOGO_MAX, { fit: 'inside', withoutEnlargement: true })
  .png()
  .toBuffer();

const { width: lw = 0, height: lh = 0 } = await sharp(logoBuf).metadata();
if (lw < 8 || lh < 8) {
  console.error('Logo rasterized too small or empty — check public/logo.svg');
  process.exit(1);
}

const left = Math.round((SIZE - lw) / 2);
const top = Math.round((SIZE - lh) / 2);

await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    { input: plateBuf, left: 0, top: 0 },
    { input: logoBuf, left, top },
  ])
  .png()
  .toFile(tmpMaster);

try {
  execFileSync('npx', ['tauri', 'icon', tmpMaster, '-o', outDir], {
    cwd: root,
    stdio: 'inherit',
  });
} finally {
  try {
    unlinkSync(tmpMaster);
  } catch {
    /* ignore */
  }
}

const iconPng = join(outDir, 'icon.png');
const master = join(root, 'src-tauri', 'icon-master.png');
if (existsSync(iconPng)) {
  copyFileSync(iconPng, master);
}
