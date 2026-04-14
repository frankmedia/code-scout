/**
 * Built-in package registry lookups for agents (npm, crates.io, PyPI).
 * Uses Tauri HTTP when available; otherwise fetch() (may hit CORS in pure browser).
 */

import { isTauri, makeHttpRequest } from '@/lib/tauri';

const HTTP_TIMEOUT_MS = 20_000;

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  if (isTauri()) {
    return Promise.race([
      makeHttpRequest(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${HTTP_TIMEOUT_MS / 1000}s`)), HTTP_TIMEOUT_MS),
      ),
    ]);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  const body = await res.text();
  return { status: res.status, body };
}

export type RegistryEcosystem = 'npm' | 'crates' | 'pypi';

function trimPkg(s: string): string {
  return s.trim();
}

/** Markdown summary for the model — errors start with "Error:" */
export async function lookupPackageMarkdown(
  ecosystem: RegistryEcosystem,
  name: string,
  version?: string,
): Promise<string> {
  const pkg = trimPkg(name);
  if (!pkg) return 'Error: empty package name.';

  try {
    if (ecosystem === 'npm') {
      const path = version
        ? `https://registry.npmjs.org/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`
        : `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;
      const { status, body } = await httpGet(path);
      if (status !== 200) {
        return `Error: npm registry returned HTTP ${status} for "${pkg}".`;
      }
      const j = JSON.parse(body) as {
        name?: string;
        version?: string;
        description?: string;
        homepage?: string;
        repository?: { url?: string } | string;
        dependencies?: Record<string, string>;
        'dist-tags'?: { latest?: string };
      };
      const lines: string[] = [];
      lines.push(`**npm:** ${j.name ?? pkg}@${j.version ?? version ?? '?'}`);
      if (j.description) lines.push(j.description);
      if (j.homepage) lines.push(`Homepage: ${j.homepage}`);
      const repo = typeof j.repository === 'object' ? j.repository?.url : j.repository;
      if (repo) lines.push(`Repository: ${repo}`);
      if (j.dependencies && Object.keys(j.dependencies).length) {
        const deps = Object.entries(j.dependencies).slice(0, 24);
        lines.push(`Dependencies (first ${deps.length}): ${deps.map(([k, v]) => `${k}@${v}`).join(', ')}`);
      }
      return lines.join('\n');
    }

    if (ecosystem === 'crates') {
      const { status, body } = await httpGet(`https://crates.io/api/v1/crates/${encodeURIComponent(pkg)}`);
      if (status === 404) return `Error: no crate named "${pkg}" on crates.io.`;
      if (status !== 200) return `Error: crates.io returned HTTP ${status}.`;
      const j = JSON.parse(body) as {
        crate?: { description?: string; max_stable_version?: string; homepage?: string; repository?: string };
        versions?: Array<{ num: string }>;
      };
      const c = j.crate;
      const ver = version ?? c?.max_stable_version ?? j.versions?.[0]?.num ?? '?';
      const lines: string[] = [];
      lines.push(`**crates.io:** ${pkg}@${ver}`);
      if (c?.description) lines.push(c.description);
      if (c?.homepage) lines.push(`Homepage: ${c.homepage}`);
      if (c?.repository) lines.push(`Repository: ${c.repository}`);
      return lines.join('\n');
    }

    // pypi
    const verPath = version
      ? `https://pypi.org/pypi/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}/json`
      : `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`;
    const { status, body } = await httpGet(verPath);
    if (status === 404) return `Error: no PyPI project "${pkg}"${version ? ` version ${version}` : ''}.`;
    if (status !== 200) return `Error: PyPI returned HTTP ${status}.`;
    const j = JSON.parse(body) as {
      info?: {
        name?: string;
        version?: string;
        summary?: string;
        home_page?: string;
        project_url?: string;
        requires_dist?: string[];
      };
    };
    const info = j.info;
    if (!info) return 'Error: unexpected PyPI JSON.';
    const lines: string[] = [];
    lines.push(`**PyPI:** ${info.name ?? pkg}@${info.version ?? version ?? '?'}`);
    if (info.summary) lines.push(info.summary);
    if (info.home_page) lines.push(`Homepage: ${info.home_page}`);
    if (info.project_url) lines.push(`Project URL: ${info.project_url}`);
    if (info.requires_dist?.length) {
      lines.push(
        `Requires (first 20): ${info.requires_dist.slice(0, 20).join('; ')}`,
      );
    }
    return lines.join('\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `Error: registry lookup failed — ${msg}`;
  }
}
