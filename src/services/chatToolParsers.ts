/**
 * chatToolParsers — argument parsers for all chat/agent tools.
 *
 * Extracted from chatTools.ts so each tool's parse logic lives in a focused module
 * that small models can read without ingesting the full tool definitions and
 * formatter code.  chatTools.ts re-exports everything from here for backward compat.
 */

export function parseRunTerminalCommand(
  argsJson: string,
): { command: string; is_background?: boolean } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.command !== 'string' || !a.command.trim()) return null;
    return {
      command: a.command.trim(),
      is_background: typeof a.is_background === 'boolean' ? a.is_background : undefined,
    };
  } catch {
    return null;
  }
}

export function parseWriteToFile(
  argsJson: string,
): { path: string; content: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.path !== 'string' || typeof a.content !== 'string') return null;
    return { path: a.path.trim(), content: a.content };
  } catch {
    return null;
  }
}

export function parseReadFile(argsJson: string): { path: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.path !== 'string') return null;
    return { path: a.path.trim() };
  } catch {
    return null;
  }
}

export function parseListDir(argsJson: string): { path: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    return { path: typeof a.path === 'string' ? a.path.trim() : '.' };
  } catch {
    return null;
  }
}

export function parseSaveMemory(
  argsJson: string,
): { title: string; content: string; category: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.title !== 'string' || typeof a.content !== 'string') return null;
    return {
      title: a.title.trim().slice(0, 80),
      content: a.content.trim(),
      category: typeof a.category === 'string' ? a.category : 'context',
    };
  } catch {
    return null;
  }
}

export function parseSearchFiles(
  argsJson: string,
): { pattern: string; path?: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.pattern !== 'string') return null;
    return {
      pattern: a.pattern,
      path: typeof a.path === 'string' ? a.path.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function parseWebSearch(argsJson: string): { query: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.query !== 'string' || !a.query.trim()) return null;
    return { query: a.query.trim() };
  } catch {
    return null;
  }
}

export function parseFetchUrl(argsJson: string): { url: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.url !== 'string' || !a.url.trim()) return null;
    return { url: a.url.trim() };
  } catch {
    return null;
  }
}

export function parseBrowseWeb(
  argsJson: string,
): { url: string; browse_actions?: unknown } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.url !== 'string' || !a.url.trim()) return null;
    const raw = a.browse_actions_json;
    let browse_actions: unknown;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        browse_actions = JSON.parse(raw) as unknown;
      } catch {
        browse_actions = raw.trim();
      }
    } else if (Array.isArray(raw)) {
      browse_actions = raw;
    }
    return { url: a.url.trim(), browse_actions };
  } catch {
    return null;
  }
}

const ECOSYSTEMS = new Set(['npm', 'crates', 'pypi']);

export function parseLookupPackage(
  argsJson: string,
): { ecosystem: 'npm' | 'crates' | 'pypi'; name: string; version?: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    const eco = a.ecosystem;
    if (typeof eco !== 'string' || !ECOSYSTEMS.has(eco)) return null;
    if (typeof a.name !== 'string' || !a.name.trim()) return null;
    const version = typeof a.version === 'string' && a.version.trim() ? a.version.trim() : undefined;
    return { ecosystem: eco as 'npm' | 'crates' | 'pypi', name: a.name.trim(), version };
  } catch {
    return null;
  }
}

export function parseGetTerminalSnapshot(argsJson: string): {
  scope: 'active' | 'all_tabs';
  max_chars: number;
} | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    const scope = a.scope === 'all_tabs' ? 'all_tabs' : 'active';
    let max_chars = 8000;
    if (typeof a.max_chars === 'number' && Number.isFinite(a.max_chars) && a.max_chars > 200) {
      max_chars = Math.min(50_000, Math.floor(a.max_chars));
    }
    return { scope, max_chars };
  } catch {
    return null;
  }
}

export function parseReplaceInFile(argsJson: string): {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
} | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.path !== 'string' || !a.path.trim()) return null;
    if (typeof a.old_string !== 'string') return null;
    if (typeof a.new_string !== 'string') return null;
    return {
      path: a.path.trim(),
      old_string: a.old_string,
      new_string: a.new_string,
      replace_all: typeof a.replace_all === 'boolean' ? a.replace_all : undefined,
    };
  } catch {
    return null;
  }
}
