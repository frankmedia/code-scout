/**
 * scaffoldRegistry — version-agnostic project scaffold archetypes.
 *
 * Each archetype describes the minimum set of files needed to bootstrap a
 * working project for a given language/framework. Package versions are
 * intentionally omitted from the source — they are resolved at runtime from
 * registry APIs (npm, PyPI, crates.io) and cached for 24 h so the agent
 * always uses a current, stable version rather than a stale hardcoded string.
 *
 * Extending: add a new entry to ARCHETYPES. No other file needs to change.
 */

import { isTauri, makeHttpRequest } from '@/lib/tauri';
import { useScaffoldStore } from '@/store/scaffoldStore';

// ─── Types ────────────────────────────────────────────────────────────────────

type Ecosystem = 'npm' | 'pypi' | 'crates';

interface PackageRef {
  ecosystem: Ecosystem;
  name: string;
  /** dev-only dep (npm only) — goes into devDependencies, not dependencies */
  dev?: boolean;
}

interface ScaffoldArchetype {
  id: string;
  /** Framework label substrings — case-insensitive partial match against ProjectIdentity.framework */
  matchFrameworks: string[];
  /** Language label substrings — case-insensitive partial match against ProjectIdentity.language */
  matchLanguages: string[];
  /** All packages that need versions resolved. Order is cosmetic only. */
  packages: PackageRef[];
  /** Human-readable one-liner shown in the prompt header */
  label: string;
  /** Shell command to install deps after files are written */
  installCmd: string;
  /** Shell command to start dev server */
  devCmd: string;
  /** Shell command to build for production */
  buildCmd: string;
  /** Shell command used for verification after changes */
  validationCmd: string;
  /**
   * Ordered list of files to create. Use {{PKG:ecosystem:name}} to inject a
   * resolved version, e.g. {{PKG:npm:react}} → "^18.3.1".
   * Content is the complete file body — no truncation.
   */
  files: Array<{ path: string; content: string }>;
}

// ─── Version cache ────────────────────────────────────────────────────────────

interface CacheEntry {
  version: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const versionCache = new Map<string, CacheEntry>();

function cacheKey(ecosystem: Ecosystem, name: string): string {
  return `${ecosystem}:${name}`;
}

function cached(ecosystem: Ecosystem, name: string): string | null {
  const entry = versionCache.get(cacheKey(ecosystem, name));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    versionCache.delete(cacheKey(ecosystem, name));
    return null;
  }
  return entry.version;
}

function store(ecosystem: Ecosystem, name: string, version: string): void {
  versionCache.set(cacheKey(ecosystem, name), { version, fetchedAt: Date.now() });
}

// ─── Registry fetchers ────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8_000;

async function httpGet(url: string): Promise<string> {
  if (isTauri()) {
    const { body } = await Promise.race([
      makeHttpRequest(url),
      new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), FETCH_TIMEOUT_MS)),
    ]);
    return body;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  return res.text();
}

async function resolveNpm(name: string): Promise<string> {
  const hit = cached('npm', name);
  if (hit) return hit;
  try {
    const body = await httpGet(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
    const j = JSON.parse(body) as { version?: string };
    const v = j.version ? `^${j.version}` : 'latest';
    store('npm', name, v);
    return v;
  } catch {
    return 'latest';
  }
}

async function resolvePypi(name: string): Promise<string> {
  const hit = cached('pypi', name);
  if (hit) return hit;
  try {
    const body = await httpGet(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    const j = JSON.parse(body) as { info?: { version?: string } };
    const v = j.info?.version ?? 'latest';
    store('pypi', name, v);
    return v;
  } catch {
    return 'latest';
  }
}

async function resolveCrates(name: string): Promise<string> {
  const hit = cached('crates', name);
  if (hit) return hit;
  try {
    const body = await httpGet(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
    const j = JSON.parse(body) as {
      crate?: { max_stable_version?: string };
      versions?: Array<{ num: string }>;
    };
    const v = j.crate?.max_stable_version ?? j.versions?.[0]?.num ?? 'latest';
    store('crates', name, v);
    return v;
  } catch {
    return 'latest';
  }
}

async function resolveOne(ecosystem: Ecosystem, name: string): Promise<string> {
  if (ecosystem === 'npm') return resolveNpm(name);
  if (ecosystem === 'pypi') return resolvePypi(name);
  return resolveCrates(name);
}

/** Resolve all packages for an archetype in parallel. Returns map of "ecosystem:name" → version. */
async function resolveVersions(packages: PackageRef[]): Promise<Map<string, string>> {
  const entries = await Promise.all(
    packages.map(async p => [cacheKey(p.ecosystem, p.name), await resolveOne(p.ecosystem, p.name)] as const),
  );
  // Validate: warn about suspicious versions (0.0.0, latest, or missing)
  for (const [key, version] of entries) {
    if (version === 'latest' || version === '^0.0.0' || version === '0.0.0') {
      console.warn(`[scaffold] Package ${key} resolved to "${version}" — may not exist on registry`);
    }
  }
  return new Map(entries);
}

/**
 * Validate all scaffold archetypes by resolving every package version.
 * Logs warnings for packages that can't be found or resolve to suspicious versions.
 * Call on startup to catch stale/broken archetypes early.
 */
export async function validateScaffoldArchetypes(): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  for (const arch of ARCHETYPES) {
    for (const pkg of arch.packages) {
      try {
        const version = await resolveOne(pkg.ecosystem, pkg.name);
        if (version === 'latest' || /^(\^)?0\.0\.0$/.test(version)) {
          warnings.push(`[${arch.id}] ${pkg.ecosystem}:${pkg.name} → "${version}" (may not exist)`);
        }
      } catch {
        warnings.push(`[${arch.id}] ${pkg.ecosystem}:${pkg.name} → resolution failed`);
      }
    }
  }
  if (warnings.length > 0) {
    console.warn(`[scaffold] ${warnings.length} package warning(s):\n${warnings.join('\n')}`);
  }
  return { ok: warnings.length === 0, warnings };
}

// ─── Template substitution ────────────────────────────────────────────────────

const PKG_RE = /\{\{PKG:([^:]+):([^}]+)\}\}/g;

function applyVersions(content: string, versions: Map<string, string>): string {
  return content.replace(PKG_RE, (_match, eco, name) => {
    return versions.get(cacheKey(eco as Ecosystem, name)) ?? 'latest';
  });
}

// ─── Archetype definitions ────────────────────────────────────────────────────

const ARCHETYPES: ScaffoldArchetype[] = [
  // ── React + Vite + TypeScript + Tailwind ─────────────────────────────────
  {
    id: 'react-vite-ts',
    label: 'React + Vite + TypeScript + Tailwind CSS',
    matchFrameworks: ['react', 'vite'],
    matchLanguages: ['typescript', 'javascript'],
    installCmd: 'npm install',
    devCmd: 'npm run dev',
    buildCmd: 'npm run build',
    validationCmd: 'npm run build',
    packages: [
      { ecosystem: 'npm', name: 'react' },
      { ecosystem: 'npm', name: 'react-dom' },
      { ecosystem: 'npm', name: 'vite', dev: true },
      { ecosystem: 'npm', name: '@vitejs/plugin-react', dev: true },
      { ecosystem: 'npm', name: 'typescript', dev: true },
      { ecosystem: 'npm', name: '@types/react', dev: true },
      { ecosystem: 'npm', name: '@types/react-dom', dev: true },
      { ecosystem: 'npm', name: 'tailwindcss', dev: true },
      { ecosystem: 'npm', name: '@tailwindcss/vite', dev: true },
      { ecosystem: 'npm', name: 'clsx' },
      { ecosystem: 'npm', name: 'tailwind-merge' },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "PROJECT_NAME",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "clsx": "{{PKG:npm:clsx}}",
    "react": "{{PKG:npm:react}}",
    "react-dom": "{{PKG:npm:react-dom}}",
    "tailwind-merge": "{{PKG:npm:tailwind-merge}}"
  },
  "devDependencies": {
    "@tailwindcss/vite": "{{PKG:npm:@tailwindcss/vite}}",
    "@types/react": "{{PKG:npm:@types/react}}",
    "@types/react-dom": "{{PKG:npm:@types/react-dom}}",
    "@vitejs/plugin-react": "{{PKG:npm:@vitejs/plugin-react}}",
    "tailwindcss": "{{PKG:npm:tailwindcss}}",
    "typescript": "{{PKG:npm:typescript}}",
    "vite": "{{PKG:npm:vite}}"
  }
}`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PROJECT_NAME</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}`,
      },
      {
        path: 'src/index.css',
        content: `@import "tailwindcss";`,
      },
      {
        path: 'src/main.tsx',
        content: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);`,
      },
      {
        path: 'src/App.tsx',
        content: `export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <h1 className="text-3xl font-bold text-gray-900">Hello World</h1>
    </div>
  );
}`,
      },
      {
        path: 'src/lib/utils.ts',
        content: `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`,
      },
      {
        path: '.gitignore',
        content: `node_modules
dist
.env
.env.local`,
      },
    ],
  },

  // ── Next.js + TypeScript + Tailwind ──────────────────────────────────────
  {
    id: 'nextjs',
    label: 'Next.js + TypeScript + Tailwind CSS',
    matchFrameworks: ['next'],
    matchLanguages: ['typescript', 'javascript'],
    installCmd: 'npm install',
    devCmd: 'npm run dev',
    buildCmd: 'npm run build',
    validationCmd: 'npm run build',
    packages: [
      { ecosystem: 'npm', name: 'next' },
      { ecosystem: 'npm', name: 'react' },
      { ecosystem: 'npm', name: 'react-dom' },
      { ecosystem: 'npm', name: 'clsx' },
      { ecosystem: 'npm', name: 'tailwind-merge' },
      { ecosystem: 'npm', name: 'typescript', dev: true },
      { ecosystem: 'npm', name: '@types/node', dev: true },
      { ecosystem: 'npm', name: '@types/react', dev: true },
      { ecosystem: 'npm', name: '@types/react-dom', dev: true },
      { ecosystem: 'npm', name: 'tailwindcss', dev: true },
      { ecosystem: 'npm', name: '@tailwindcss/postcss', dev: true },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "PROJECT_NAME",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "clsx": "{{PKG:npm:clsx}}",
    "next": "{{PKG:npm:next}}",
    "react": "{{PKG:npm:react}}",
    "react-dom": "{{PKG:npm:react-dom}}",
    "tailwind-merge": "{{PKG:npm:tailwind-merge}}"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "{{PKG:npm:@tailwindcss/postcss}}",
    "@types/node": "{{PKG:npm:@types/node}}",
    "@types/react": "{{PKG:npm:@types/react}}",
    "@types/react-dom": "{{PKG:npm:@types/react-dom}}",
    "tailwindcss": "{{PKG:npm:tailwindcss}}",
    "typescript": "{{PKG:npm:typescript}}"
  }
}`,
      },
      {
        path: 'postcss.config.mjs',
        content: `/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
      },
      {
        path: 'tailwind.config.ts',
        content: `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;`,
      },
      {
        path: 'src/app/globals.css',
        content: `@import "tailwindcss";`,
      },
      {
        path: 'src/app/layout.tsx',
        content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PROJECT_NAME",
  description: "Generated by Code Scout",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}`,
      },
      {
        path: 'src/app/page.tsx',
        content: `export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <h1 className="text-4xl font-bold">Hello World</h1>
    </main>
  );
}`,
      },
      {
        path: 'src/lib/utils.ts',
        content: `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}`,
      },
      {
        path: 'next.config.mjs',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
};

export default nextConfig;`,
      },
      {
        path: '.gitignore',
        content: `node_modules
.next
out
dist
.env
.env.local`,
      },
    ],
  },

  // ── Vue + Vite + TypeScript + Tailwind ───────────────────────────────────
  {
    id: 'vue-vite-ts',
    label: 'Vue 3 + Vite + TypeScript + Tailwind CSS',
    matchFrameworks: ['vue'],
    matchLanguages: ['typescript', 'javascript'],
    installCmd: 'npm install',
    devCmd: 'npm run dev',
    buildCmd: 'npm run build',
    validationCmd: 'npm run build',
    packages: [
      { ecosystem: 'npm', name: 'vue' },
      { ecosystem: 'npm', name: 'vite', dev: true },
      { ecosystem: 'npm', name: '@vitejs/plugin-vue', dev: true },
      { ecosystem: 'npm', name: 'typescript', dev: true },
      { ecosystem: 'npm', name: 'vue-tsc', dev: true },
      { ecosystem: 'npm', name: 'tailwindcss', dev: true },
      { ecosystem: 'npm', name: '@tailwindcss/vite', dev: true },
    ],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "PROJECT_NAME",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "{{PKG:npm:vue}}"
  },
  "devDependencies": {
    "@tailwindcss/vite": "{{PKG:npm:@tailwindcss/vite}}",
    "@vitejs/plugin-vue": "{{PKG:npm:@vitejs/plugin-vue}}",
    "tailwindcss": "{{PKG:npm:tailwindcss}}",
    "typescript": "{{PKG:npm:typescript}}",
    "vite": "{{PKG:npm:vite}}",
    "vue-tsc": "{{PKG:npm:vue-tsc}}"
  }
}`,
      },
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PROJECT_NAME</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>`,
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
});`,
      },
      {
        path: 'tsconfig.json',
        content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"]
}`,
      },
      {
        path: 'src/style.css',
        content: `@import "tailwindcss";`,
      },
      {
        path: 'src/main.ts',
        content: `import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";

createApp(App).mount("#app");`,
      },
      {
        path: 'src/App.vue',
        content: `<script setup lang="ts">
import { ref } from "vue";
const count = ref(0);
</script>

<template>
  <div class="min-h-screen bg-gray-50 flex items-center justify-center">
    <div class="text-center">
      <h1 class="text-3xl font-bold text-gray-900 mb-4">Hello World</h1>
      <button
        class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        @click="count++"
      >Count: {{ count }}</button>
    </div>
  </div>
</template>`,
      },
    ],
  },

  // ── Python (generic / script) ─────────────────────────────────────────────
  {
    id: 'python-pip',
    label: 'Python project',
    matchFrameworks: ['python', 'unknown'],
    matchLanguages: ['python'],
    installCmd: 'pip install -r requirements.txt',
    devCmd: 'python3 main.py',
    buildCmd: 'python3 -m py_compile main.py',
    validationCmd: 'python3 -m py_compile main.py',
    packages: [],
    files: [
      {
        path: 'requirements.txt',
        content: `# Add your dependencies here, one per line
# e.g. requests==2.31.0`,
      },
      {
        path: 'main.py',
        content: `def main():
    print("Hello, World!")

if __name__ == "__main__":
    main()`,
      },
      {
        path: '.gitignore',
        content: `__pycache__/
*.py[cod]
.venv/
venv/
*.egg-info/
dist/
build/
.env`,
      },
    ],
  },

  // ── Python + FastAPI ──────────────────────────────────────────────────────
  {
    id: 'python-fastapi',
    label: 'Python + FastAPI',
    matchFrameworks: ['fastapi', 'flask', 'django'],
    matchLanguages: ['python'],
    installCmd: 'pip install -r requirements.txt',
    devCmd: 'uvicorn main:app --reload',
    buildCmd: 'python3 -m py_compile main.py',
    validationCmd: 'python3 -m py_compile main.py',
    packages: [
      { ecosystem: 'pypi', name: 'fastapi' },
      { ecosystem: 'pypi', name: 'uvicorn' },
    ],
    files: [
      {
        path: 'requirements.txt',
        content: `fastapi=={{PKG:pypi:fastapi}}
uvicorn=={{PKG:pypi:uvicorn}}`,
      },
      {
        path: 'main.py',
        content: `from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello, World!"}`,
      },
      {
        path: '.gitignore',
        content: `__pycache__/
*.py[cod]
.venv/
venv/
.env`,
      },
    ],
  },

  // ── Rust + Cargo ──────────────────────────────────────────────────────────
  {
    id: 'rust-cargo',
    label: 'Rust + Cargo',
    matchFrameworks: ['rust', 'unknown'],
    matchLanguages: ['rust'],
    installCmd: 'cargo build',
    devCmd: 'cargo run',
    buildCmd: 'cargo build --release',
    validationCmd: 'cargo build',
    packages: [],
    files: [
      {
        path: 'Cargo.toml',
        content: `[package]
name = "project_name"
version = "0.1.0"
edition = "2021"

[dependencies]`,
      },
      {
        path: 'src/main.rs',
        content: `fn main() {
    println!("Hello, World!");
}`,
      },
      {
        path: '.gitignore',
        content: `/target`,
      },
    ],
  },

  // ── Go module ─────────────────────────────────────────────────────────────
  {
    id: 'go-mod',
    label: 'Go module',
    matchFrameworks: ['go', 'unknown'],
    matchLanguages: ['go'],
    installCmd: 'go mod tidy',
    devCmd: 'go run .',
    buildCmd: 'go build ./...',
    validationCmd: 'go build ./...',
    packages: [],
    files: [
      {
        path: 'go.mod',
        content: `module project_name

go 1.22`,
      },
      {
        path: 'main.go',
        content: `package main

import "fmt"

func main() {
	fmt.Println("Hello, World!")
}`,
      },
      {
        path: '.gitignore',
        content: `# Binaries
project_name
*.exe`,
      },
    ],
  },

  // ── PHP + Composer ────────────────────────────────────────────────────────
  {
    id: 'php-composer',
    label: 'PHP + Composer',
    matchFrameworks: ['php', 'laravel', 'symfony', 'unknown'],
    matchLanguages: ['php'],
    installCmd: 'composer install',
    devCmd: 'php -S localhost:8000 -t public',
    buildCmd: 'composer install --no-dev',
    validationCmd: 'php -l public/index.php',
    packages: [],
    files: [
      {
        path: 'composer.json',
        content: `{
  "name": "vendor/project_name",
  "description": "PROJECT_NAME",
  "type": "project",
  "require": {
    "php": ">=8.1"
  },
  "autoload": {
    "psr-4": {
      "App\\\\": "src/"
    }
  }
}`,
      },
      {
        path: 'public/index.php',
        content: `<?php
declare(strict_types=1);

echo "Hello, World!";`,
      },
      {
        path: '.gitignore',
        content: `/vendor/
.env`,
      },
    ],
  },

  // ── Node.js (vanilla / no bundler) ───────────────────────────────────────
  {
    id: 'node-vanilla',
    label: 'Node.js (vanilla)',
    matchFrameworks: ['node', 'express'],
    matchLanguages: ['javascript'],
    installCmd: 'npm install',
    devCmd: 'node index.js',
    buildCmd: 'node -e "process.exit(0)"',
    validationCmd: 'node --check index.js',
    packages: [],
    files: [
      {
        path: 'package.json',
        content: `{
  "name": "PROJECT_NAME",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "start": "node index.js"
  }
}`,
      },
      {
        path: 'index.js',
        content: `console.log("Hello, World!");`,
      },
      {
        path: '.gitignore',
        content: `node_modules/
.env`,
      },
    ],
  },
];

// ─── Archetype matching ───────────────────────────────────────────────────────

function matchArchetype(framework: string, language: string): ScaffoldArchetype | null {
  const fw = framework.toLowerCase();
  const lang = language.toLowerCase();

  // Scored match: most specific wins
  let best: ScaffoldArchetype | null = null;
  let bestScore = 0;

  for (const arch of ARCHETYPES) {
    let score = 0;
    const fwMatch = arch.matchFrameworks.some(f => fw.includes(f) || f.includes(fw));
    const langMatch = arch.matchLanguages.some(l => lang.includes(l) || l.includes(lang));

    if (fwMatch) score += 2;
    if (langMatch) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = arch;
    }
  }

  // Require at least a language match for generic archetypes
  return bestScore > 0 ? best : null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a version-resolved scaffold reference string for the given
 * framework/language. Returns null if no matching archetype exists
 * (the model will figure out the setup on its own).
 *
 * This is async because it hits registry APIs on the first call; subsequent
 * calls within 24 h are served from the in-process cache.
 */
export async function buildScaffoldPrompt(
  framework: string,
  language: string,
  projectName: string,
): Promise<string | null> {
  const arch = matchArchetype(framework, language);
  if (!arch) return null;

  // Get user customizations for this archetype
  const customization = useScaffoldStore.getState().getCustomization(arch.id);

  // Merge base packages with user's extra packages
  const allPackages: PackageRef[] = [
    ...arch.packages,
    ...customization.extraPackages.map(p => ({ ecosystem: 'npm' as Ecosystem, name: p.name, dev: p.dev })),
  ];

  // Filter out Tailwind if disabled
  const packages = customization.includeTailwind
    ? allPackages
    : allPackages.filter(p => !p.name.includes('tailwind'));

  // Resolve all package versions in parallel
  const versions = await resolveVersions(packages);

  // Filter files based on customization
  let files = arch.files;
  if (!customization.includeTailwind) {
    files = files.filter(f =>
      !f.path.includes('tailwind.config') &&
      !f.path.includes('postcss.config')
    );
  }

  // Modify tsconfig for strict mode setting
  if (!customization.strictTypeScript) {
    files = files.map(f => {
      if (f.path.includes('tsconfig.json')) {
        return {
          ...f,
          content: f.content.replace('"strict": true', '"strict": false'),
        };
      }
      return f;
    });
  }

  const fileList = files.map((f, i) => {
    let content = applyVersions(
      f.content.replace(/PROJECT_NAME/g, projectName),
      versions,
    );

    // Add custom CSS if this is the globals/main CSS file
    if (customization.customCss && (f.path.includes('globals.css') || f.path.includes('index.css') || f.path.includes('style.css'))) {
      content = content + '\n\n' + customization.customCss;
    }

    // Update package.json with extra packages
    if (f.path === 'package.json' && customization.extraPackages.length > 0) {
      try {
        const pkg = JSON.parse(content);
        for (const extra of customization.extraPackages) {
          const v = versions.get(cacheKey('npm', extra.name)) ?? 'latest';
          if (extra.dev) {
            pkg.devDependencies = pkg.devDependencies || {};
            pkg.devDependencies[extra.name] = v;
          } else {
            pkg.dependencies = pkg.dependencies || {};
            pkg.dependencies[extra.name] = v;
          }
        }
        content = JSON.stringify(pkg, null, 2);
      } catch {
        // If JSON parsing fails, leave content as-is
      }
    }

    return `${i + 1}. \`${f.path}\`:\n\`\`\`\n${content}\n\`\`\``;
  }).join('\n\n');

  const pkgSummary = packages.length > 0
    ? `\nKey packages (versions resolved from registry):\n${packages.map(p => {
        const v = versions.get(cacheKey(p.ecosystem, p.name)) ?? 'latest';
        const isExtra = customization.extraPackages.some(e => e.name === p.name);
        return `- ${p.name}@${v}${p.dev ? ' (dev)' : ''}${isExtra ? ' [custom]' : ''}`;
      }).join('\n')}`
    : '';

  return `SCAFFOLD REFERENCE — ${arch.label}
Write ALL files below in order before running any build or install command.
${pkgSummary}

Install: \`${arch.installCmd}\`
Dev: \`${arch.devCmd}\`
Build: \`${arch.buildCmd}\`

Files to create:

${fileList}

CRITICAL: Do NOT skip any file above. Do NOT run build/dev commands before install. index.html (if present) goes in the PROJECT ROOT, not inside src/.`;
}

/**
 * Same as buildScaffoldPrompt but returns a compact single-paragraph hint
 * for use in shared SCRIPT_EXECUTION_RULES (no full file contents).
 */
export async function buildScaffoldHint(framework: string, language: string): Promise<string | null> {
  const arch = matchArchetype(framework, language);
  if (!arch) return null;

  // Get user customizations
  const customization = useScaffoldStore.getState().getCustomization(arch.id);

  // Merge packages
  const allPackages: PackageRef[] = [
    ...arch.packages,
    ...customization.extraPackages.map(p => ({ ecosystem: 'npm' as Ecosystem, name: p.name, dev: p.dev })),
  ];
  const packages = customization.includeTailwind
    ? allPackages
    : allPackages.filter(p => !p.name.includes('tailwind'));

  const versions = await resolveVersions(packages);
  const filePaths = arch.files.map(f => f.path).join(', ');
  const pkgList = packages.length > 0
    ? packages.map(p => {
        const v = versions.get(cacheKey(p.ecosystem, p.name)) ?? 'latest';
        return `${p.name}@${v}`;
      }).join(', ')
    : 'none';
  return `${arch.label}: create [${filePaths}], packages: ${pkgList}. Install: \`${arch.installCmd}\`. Dev: \`${arch.devCmd}\`.`;
}

/** List all supported archetypes for the "unknown framework" hint. */
export function listSupportedArchetypes(): string {
  return ARCHETYPES.map(a => `- **${a.label}** (id: ${a.id}): ${a.installCmd} → ${a.devCmd}`).join('\n');
}
