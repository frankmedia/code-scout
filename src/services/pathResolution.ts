/**
 * pathResolution — file path normalization and fuzzy resolution helpers.
 *
 * Extracted from agentExecutor.ts so path-fixing logic lives in a focused module.
 * LLMs frequently hallucinate paths: double prefixes (src/src/), wrong extensions
 * (.js vs .ts), missing project prefixes, etc. This module corrects those.
 *
 * agentExecutor.ts re-exports everything from here for backward compat.
 */

// ─── Normalisation ─────────────────────────────────────────────────────────────

/** Normalise a file path to a consistent relative form (forward slashes, no leading slash). */
export function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Simple Levenshtein distance for fuzzy matching short strings (file basenames). */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

// ─── Project prefix detection ──────────────────────────────────────────────────

/**
 * Detect the common directory prefix shared by project files in the tree.
 * E.g. if all files start with "website/", returns "website/".
 * Returns "" if files are at the root or have mixed prefixes.
 *
 * Hidden directories (.codescout, .git, .vscode, etc.) and root-level files
 * are excluded from the check — they are metadata, not project source.
 */
export function detectFileTreePrefix(allFiles: { path: string }[]): string {
  if (!allFiles || allFiles.length === 0) return '';
  const withSlash = allFiles.filter(f => {
    if (!f.path.includes('/')) return false;
    const firstSeg = f.path.split('/')[0];
    return !firstSeg.startsWith('.');
  });
  if (withSlash.length === 0) return '';
  const counts = new Map<string, number>();
  for (const f of withSlash) {
    const seg = f.path.split('/')[0];
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  if (counts.size === 1) {
    const [prefix] = counts.keys();
    return `${prefix}/`;
  }
  const total = withSlash.length;
  for (const [seg, count] of counts) {
    if (count / total >= 0.8) return `${seg}/`;
  }
  return '';
}

// ─── Fuzzy file path resolver ──────────────────────────────────────────────────

export function resolveFilePath(
  rawPath: string,
  getFileContent: (path: string) => string | undefined,
  allFiles?: { path: string }[],
): { resolved: string; changed: boolean } {
  const p = normalizePath(rawPath);

  if (getFileContent(p) !== undefined) return { resolved: p, changed: false };

  const projectPrefix = allFiles ? detectFileTreePrefix(allFiles) : '';

  const doublePrefix = p.match(/^([^/]+)\/\1\/(.*)/);
  if (doublePrefix) {
    const fixed = `${doublePrefix[1]}/${doublePrefix[2]}`;
    if (getFileContent(fixed) !== undefined) return { resolved: fixed, changed: true };
    if (projectPrefix && getFileContent(projectPrefix + fixed) !== undefined) {
      return { resolved: projectPrefix + fixed, changed: true };
    }
  }

  if (projectPrefix && !p.startsWith(projectPrefix)) {
    const withPrefix = projectPrefix + p;
    if (getFileContent(withPrefix) !== undefined) return { resolved: withPrefix, changed: true };
  }

  const parts = p.split('/');
  if (parts.length >= 2) {
    const stripped = parts.slice(1).join('/');
    if (getFileContent(stripped) !== undefined) return { resolved: stripped, changed: true };
    if (projectPrefix && getFileContent(projectPrefix + stripped) !== undefined) {
      return { resolved: projectPrefix + stripped, changed: true };
    }
  }

  const extSwaps: Record<string, string[]> = {
    '.js':  ['.ts', '.jsx', '.tsx', '.mjs', '.cjs'],
    '.ts':  ['.js', '.tsx', '.jsx'],
    '.jsx': ['.tsx', '.js', '.ts'],
    '.tsx': ['.jsx', '.ts', '.js'],
    '.mjs': ['.js', '.ts'],
    '.cjs': ['.js', '.ts'],
  };
  const ext = '.' + (p.split('.').pop() ?? '');
  const base = p.slice(0, p.length - ext.length);
  for (const alt of extSwaps[ext] ?? []) {
    const altPath = base + alt;
    if (getFileContent(altPath) !== undefined) return { resolved: altPath, changed: true };
    if (projectPrefix && getFileContent(projectPrefix + altPath) !== undefined) {
      return { resolved: projectPrefix + altPath, changed: true };
    }
  }

  const tryPrefixes = ['src/', 'app/', 'lib/', 'pages/'];
  for (const pre of tryPrefixes) {
    if (!p.startsWith(pre)) {
      const withPre = pre + p;
      if (getFileContent(withPre) !== undefined) return { resolved: withPre, changed: true };
      if (projectPrefix && getFileContent(projectPrefix + withPre) !== undefined) {
        return { resolved: projectPrefix + withPre, changed: true };
      }
    }
    if (p.startsWith(pre)) {
      const withoutPre = p.slice(pre.length);
      if (getFileContent(withoutPre) !== undefined) return { resolved: withoutPre, changed: true };
      if (projectPrefix && getFileContent(projectPrefix + withoutPre) !== undefined) {
        return { resolved: projectPrefix + withoutPre, changed: true };
      }
    }
  }

  if (allFiles) {
    const basename = p.split('/').pop()!;
    const matches = allFiles.filter(f => f.path.endsWith('/' + basename) || f.path === basename);
    if (matches.length === 1) return { resolved: matches[0].path, changed: true };
    // Fuzzy: find files with similar basename (Levenshtein distance ≤ 2)
    if (matches.length === 0 && basename.length >= 4) {
      const similar = allFiles.filter(f => {
        const fb = f.path.split('/').pop()!;
        return levenshtein(basename.toLowerCase(), fb.toLowerCase()) <= 2;
      });
      if (similar.length === 1) return { resolved: similar[0].path, changed: true };
    }
  }

  if (doublePrefix) {
    const fixed = `${doublePrefix[1]}/${doublePrefix[2]}`;
    return { resolved: projectPrefix ? projectPrefix + fixed : fixed, changed: true };
  }

  if (projectPrefix && !p.startsWith(projectPrefix)) {
    return { resolved: projectPrefix + p, changed: true };
  }

  return { resolved: p, changed: false };
}

/**
 * When a file is not found, suggest similar paths from the project tree.
 * Returns up to 3 suggestions sorted by relevance.
 */
export function suggestSimilarPaths(
  rawPath: string,
  allFiles: { path: string }[],
  limit = 3,
): string[] {
  if (!allFiles || allFiles.length === 0) return [];
  const p = normalizePath(rawPath);
  const basename = p.split('/').pop()!;
  const baseLower = basename.toLowerCase();

  type Scored = { path: string; score: number };
  const scored: Scored[] = [];

  for (const f of allFiles) {
    const fb = f.path.split('/').pop()!;
    const fbLower = fb.toLowerCase();
    // Exact basename match in different directory
    if (fbLower === baseLower) {
      scored.push({ path: f.path, score: 0 });
      continue;
    }
    // Levenshtein distance for typos
    const dist = levenshtein(baseLower, fbLower);
    if (dist <= 3) {
      scored.push({ path: f.path, score: dist });
      continue;
    }
    // Substring match (partial name)
    if (fbLower.includes(baseLower) || baseLower.includes(fbLower)) {
      scored.push({ path: f.path, score: 4 });
    }
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(s => s.path);
}

// ─── Command path normalisation ────────────────────────────────────────────────

const DOUBLE_DIR_IN_COMMAND = /([a-zA-Z0-9_.-]+)\/\1\//g;

/**
 * Fix doubled path segments inside a shell command (mv, mkdir, cp, rm, etc.).
 * LLMs often emit src/src/... even when the real tree is src/...
 */
export function normalizeCommandPaths(command: string): { normalized: string; changed: boolean } {
  let out = command;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(DOUBLE_DIR_IN_COMMAND, '$1/');
  }
  return { normalized: out, changed: out !== command };
}

// ─── Background command detection ─────────────────────────────────────────────

const BACKGROUND_CMD_PATTERNS = [
  /\bnpm run (dev|start|serve|watch)\b/,
  /\bnpm start\b/,
  /\bnpx (vite|next|nuxt|remix|astro|webpack-dev-server)\b/,
  /\bpnpm (run\s+)?(dev|start|serve|watch)\b/,
  /\byarn (run\s+)?(dev|start|serve|watch)\b/,
  /\bbun (run\s+)?(dev|start|serve|watch)\b/,
  /\bcargo (run|watch)\b/,
  /\bpython.*-m\s+(http\.server|flask|uvicorn|gunicorn)\b/,
  /\bnode\s+.*server/,
  /\bnodemon\b/,
  /\btailwindcss.*--watch\b/,
  /^vite(?!\s+build)(\s|$)/,
  /^next\s+(dev|start)\b/,
  /^nuxt\s+(dev|start)\b/,
  /^astro\s+dev\b/,
  /^remix\s+dev\b/,
  /^react-scripts\s+start\b/,
  /^expo\s+start\b/,
];

export function isBackgroundCommand(cmd: string): boolean {
  return BACKGROUND_CMD_PATTERNS.some(p => p.test(cmd));
}
