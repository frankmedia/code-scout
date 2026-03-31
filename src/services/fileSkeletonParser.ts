/**
 * File Skeleton Parser — extracts minimal structural summaries from source files
 * WITHOUT using an LLM. Produces compact representations suitable for small-model
 * context windows: function signatures, type/interface definitions, exports, imports,
 * class outlines — all function bodies stripped.
 *
 * Cross-platform: works on Windows + macOS + Linux (no OS-specific code).
 */

import { FileNode } from '@/store/workbenchStore';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileSkeleton {
  path: string;
  language: string;
  imports: string[];
  exports: string[];
  types: string[];        // interface / type alias signatures
  functions: string[];    // function / method signatures (no bodies)
  classes: string[];      // class Name { method signatures }
  constants: string[];    // top-level const/let assignments (value omitted)
  /** Compact one-string representation for injection into prompts */
  compact: string;
}

export interface ProjectSkeleton {
  files: FileSkeleton[];
  /** Combined compact text for all files — ready to inject as context */
  fullText: string;
  /** Approximate token count (~4 chars/token) */
  approxTokens: number;
  generatedAt: number;
}

// ─── Language detection ──────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', swift: 'swift', dart: 'dart',
  vue: 'vue', svelte: 'svelte',
  css: 'css', scss: 'scss', html: 'html',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  md: 'markdown', txt: 'text',
};

/** Extensions worth skeleton-parsing (code files) */
const PARSEABLE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'kt',
  'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'dart',
  'vue', 'svelte',
]);

/** Directories to always skip */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.svelte-kit', '.cache', '__pycache__', '.venv', 'venv',
  'target', 'bin', 'obj', '.idea', '.vscode',
  'coverage', '.turbo', '.output',
]);

/** Max file size in chars to attempt parsing (skip huge generated files) */
const MAX_FILE_SIZE = 100_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExt(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
}

function getLang(path: string): string {
  return EXT_LANG[getExt(path)] || 'unknown';
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

function shouldParseFile(node: FileNode): boolean {
  if (node.type !== 'file') return false;
  if (!node.content) return false;
  if (node.content.length > MAX_FILE_SIZE) return false;
  return PARSEABLE_EXTS.has(getExt(node.path));
}

// ─── Extraction: TypeScript / JavaScript ─────────────────────────────────────

function extractTS(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'> {
  const lines = content.split('\n');
  const imports: string[] = [];
  const exports: string[] = [];
  const types: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const constants: string[] = [];

  let inBlock = 0; // brace depth for skipping bodies
  let capturing: 'type' | 'class' | null = null;
  let captureLines: string[] = [];
  let captureDepth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;

    // Imports
    if (line.startsWith('import ')) {
      const from = line.match(/from\s+['"]([^'"]+)['"]/);
      if (from) imports.push(from[1]);
      continue;
    }

    // Type / Interface (may span multiple lines)
    const typeMatch = line.match(
      /^(export\s+)?(?:type|interface)\s+(\w+)(?:<[^>]+>)?\s*(?:=\s*|extends\s+\w+(?:<[^>]+>)?\s*)?(\{?)$/,
    );
    if (typeMatch || /^(export\s+)?(?:type|interface)\s+\w+/.test(line)) {
      if (typeMatch) {
        const sig = `${typeMatch[1] || ''}${line.includes('interface') ? 'interface' : 'type'} ${typeMatch[2]}`;
        types.push(sig.trim());
        if (typeMatch[1]) exports.push(typeMatch[2]);
      } else {
        const m = line.match(/(?:type|interface)\s+(\w+)/);
        if (m) {
          types.push(line.replace(/\{.*$/, '').trim());
          if (line.startsWith('export')) exports.push(m[1]);
        }
      }
      continue;
    }

    // Exported function / arrow
    const fnMatch = line.match(
      /^(export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{?/,
    );
    if (fnMatch) {
      const name = fnMatch[2];
      const params = fnMatch[3]?.trim() || '';
      const ret = fnMatch[4]?.trim() || '';
      functions.push(`${fnMatch[1]?.trim() || ''} function ${name}(${params})${ret ? ': ' + ret : ''}`.trim());
      if (fnMatch[1]) exports.push(name);
      continue;
    }

    // Arrow function const
    const arrowMatch = line.match(
      /^(export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|(\w+))\s*(?::\s*\w[^=]*?)?\s*=>/,
    );
    if (arrowMatch) {
      const name = arrowMatch[2];
      const sig = line.replace(/\s*=>\s*.*$/, '').replace(/\s*=\s*(?:async\s+)?/, '(').trim();
      functions.push(`${arrowMatch[1]?.trim() || ''} const ${name} = (...)`.trim());
      if (arrowMatch[1]) exports.push(name);
      continue;
    }

    // React component (const Foo = (...) => { or memo/forwardRef)
    const compMatch = line.match(
      /^(export\s+)?(?:const|let)\s+(\w+)\s*(?::\s*\w[^=]*)?\s*=\s*(?:React\.)?(?:memo|forwardRef)?\s*\(/,
    );
    if (compMatch && /^[A-Z]/.test(compMatch[2])) {
      functions.push(`${compMatch[1]?.trim() || ''} const ${compMatch[2]} = Component`.trim());
      if (compMatch[1]) exports.push(compMatch[2]);
      continue;
    }

    // Class
    const classMatch = line.match(/^(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (classMatch) {
      classes.push(`${classMatch[1]?.trim() || ''} class ${classMatch[2]}`.trim());
      if (classMatch[1]) exports.push(classMatch[2]);
      continue;
    }

    // Exported const (non-function)
    const constMatch = line.match(/^(export\s+)(?:const|let|var)\s+(\w+)/);
    if (constMatch && !arrowMatch && !compMatch) {
      constants.push(`export ${constMatch[2]}`);
      exports.push(constMatch[2]);
      continue;
    }

    // Re-exports
    if (line.startsWith('export {') || line.startsWith('export *')) {
      const names = line.match(/\b(\w+)\b(?=\s*[,}])/g);
      if (names) exports.push(...names.filter(n => n !== 'export' && n !== 'from'));
      continue;
    }

    // export default
    if (line.startsWith('export default')) {
      const m = line.match(/export default\s+(\w+)/);
      if (m) exports.push(`default(${m[1]})`);
      continue;
    }
  }

  return { imports, exports: [...new Set(exports)], types, functions, classes, constants };
}

// ─── Extraction: Python ──────────────────────────────────────────────────────

function extractPython(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'> {
  const lines = content.split('\n');
  const imports: string[] = [];
  const exports: string[] = [];
  const types: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const constants: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // imports
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      const m = trimmed.match(/(?:from\s+(\S+)\s+)?import\s+(.+)/);
      if (m) imports.push(m[1] || m[2].split(',')[0].trim());
      continue;
    }

    // Top-level function (no leading whitespace)
    const fnMatch = trimmed.match(/^def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?\s*:/);
    if (fnMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      const ret = fnMatch[3] ? ` -> ${fnMatch[3]}` : '';
      functions.push(`def ${fnMatch[1]}(${fnMatch[2]})${ret}`);
      if (!fnMatch[1].startsWith('_')) exports.push(fnMatch[1]);
      continue;
    }

    // async def
    const asyncFnMatch = trimmed.match(/^async\s+def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?\s*:/);
    if (asyncFnMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      const ret = asyncFnMatch[3] ? ` -> ${asyncFnMatch[3]}` : '';
      functions.push(`async def ${asyncFnMatch[1]}(${asyncFnMatch[2]})${ret}`);
      if (!asyncFnMatch[1].startsWith('_')) exports.push(asyncFnMatch[1]);
      continue;
    }

    // Class
    const classMatch = trimmed.match(/^class\s+(\w+)(?:\(([^)]*)\))?\s*:/);
    if (classMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      classes.push(`class ${classMatch[1]}${classMatch[2] ? '(' + classMatch[2] + ')' : ''}`);
      if (!classMatch[1].startsWith('_')) exports.push(classMatch[1]);
      continue;
    }

    // Top-level constant (UPPER_CASE = ...)
    if (/^[A-Z_][A-Z0-9_]*\s*=/.test(trimmed) && !line.startsWith(' ') && !line.startsWith('\t')) {
      const name = trimmed.split('=')[0].trim();
      constants.push(name);
      exports.push(name);
    }
  }

  return { imports, exports, types, functions, classes, constants };
}

// ─── Extraction: Rust ────────────────────────────────────────────────────────

function extractRust(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'> {
  const lines = content.split('\n');
  const imports: string[] = [];
  const exports: string[] = [];
  const types: string[] = [];
  const functions: string[] = [];
  const classes: string[] = []; // structs/enums
  const constants: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    if (line.startsWith('use ')) {
      const m = line.match(/use\s+(.+);/);
      if (m) imports.push(m[1]);
      continue;
    }

    const fnMatch = line.match(/^(pub\s+)?(?:async\s+)?fn\s+(\w+)(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/);
    if (fnMatch) {
      const ret = fnMatch[4] ? ` -> ${fnMatch[4]}` : '';
      functions.push(`${fnMatch[1] || ''}fn ${fnMatch[2]}(${fnMatch[3].slice(0, 60)})${ret}`.trim());
      if (fnMatch[1]) exports.push(fnMatch[2]);
      continue;
    }

    const structMatch = line.match(/^(pub\s+)?struct\s+(\w+)/);
    if (structMatch) {
      classes.push(`${structMatch[1] || ''}struct ${structMatch[2]}`.trim());
      if (structMatch[1]) exports.push(structMatch[2]);
      continue;
    }

    const enumMatch = line.match(/^(pub\s+)?enum\s+(\w+)/);
    if (enumMatch) {
      types.push(`${enumMatch[1] || ''}enum ${enumMatch[2]}`.trim());
      if (enumMatch[1]) exports.push(enumMatch[2]);
      continue;
    }

    const traitMatch = line.match(/^(pub\s+)?trait\s+(\w+)/);
    if (traitMatch) {
      types.push(`${traitMatch[1] || ''}trait ${traitMatch[2]}`.trim());
      if (traitMatch[1]) exports.push(traitMatch[2]);
    }
  }

  return { imports, exports, types, functions, classes, constants };
}

// ─── Extraction: Go ──────────────────────────────────────────────────────────

function extractGo(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'> {
  const lines = content.split('\n');
  const imports: string[] = [];
  const exports: string[] = [];
  const types: string[] = [];
  const functions: string[] = [];
  const classes: string[] = []; // structs
  const constants: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    if (/^import\s+/.test(line) || /^"/.test(line)) {
      const m = line.match(/"([^"]+)"/);
      if (m) imports.push(m[1]);
      continue;
    }

    const fnMatch = line.match(/^func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*(.+))?\s*\{?$/);
    if (fnMatch) {
      const receiver = fnMatch[2] ? `(${fnMatch[2]}).` : '';
      const name = fnMatch[3];
      const ret = fnMatch[5]?.replace('{', '').trim() || '';
      functions.push(`func ${receiver}${name}(${fnMatch[4].slice(0, 60)})${ret ? ' ' + ret : ''}`);
      if (/^[A-Z]/.test(name)) exports.push(name);
      continue;
    }

    const typeMatch = line.match(/^type\s+(\w+)\s+(struct|interface)/);
    if (typeMatch) {
      (typeMatch[2] === 'struct' ? classes : types).push(`type ${typeMatch[1]} ${typeMatch[2]}`);
      if (/^[A-Z]/.test(typeMatch[1])) exports.push(typeMatch[1]);
    }
  }

  return { imports, exports, types, functions, classes, constants };
}

// ─── Generic fallback ────────────────────────────────────────────────────────

function extractGeneric(content: string): Omit<FileSkeleton, 'path' | 'language' | 'compact'> {
  const lines = content.split('\n');
  const imports: string[] = [];
  const exports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const types: string[] = [];
  const constants: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Generic import patterns
    const impMatch = line.match(/(?:import|require|use|include|#include)\s+['"<]?([^'">;\s]+)/);
    if (impMatch) { imports.push(impMatch[1]); continue; }

    // Generic function
    const fnMatch = line.match(/(?:public|private|protected|static|async|export)?\s*(?:function|def|fn|func|fun|sub)\s+(\w+)/);
    if (fnMatch) { functions.push(fnMatch[0].trim()); continue; }

    // Generic class
    const clsMatch = line.match(/(?:public|private|export)?\s*(?:class|struct)\s+(\w+)/);
    if (clsMatch) { classes.push(clsMatch[0].trim()); continue; }
  }

  return { imports, exports, types, functions, classes, constants };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

function extractSkeleton(path: string, content: string): FileSkeleton {
  const lang = getLang(path);
  let extracted: Omit<FileSkeleton, 'path' | 'language' | 'compact'>;

  switch (lang) {
    case 'typescript':
    case 'javascript':
    case 'vue':
    case 'svelte':
      extracted = extractTS(content);
      break;
    case 'python':
      extracted = extractPython(content);
      break;
    case 'rust':
      extracted = extractRust(content);
      break;
    case 'go':
      extracted = extractGo(content);
      break;
    default:
      extracted = extractGeneric(content);
  }

  // Build compact representation
  const parts: string[] = [`// ${path}`];
  if (extracted.imports.length) parts.push(`imports: ${extracted.imports.join(', ')}`);
  if (extracted.types.length) parts.push(...extracted.types);
  if (extracted.classes.length) parts.push(...extracted.classes);
  if (extracted.functions.length) parts.push(...extracted.functions);
  if (extracted.constants.length) parts.push(`constants: ${extracted.constants.join(', ')}`);
  if (extracted.exports.length) parts.push(`exports: ${extracted.exports.join(', ')}`);

  return {
    path,
    language: lang,
    ...extracted,
    compact: parts.join('\n'),
  };
}

// ─── Tree traversal ──────────────────────────────────────────────────────────

function collectFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === 'folder') {
      if (!shouldSkipDir(node.name)) {
        if (node.children) result.push(...collectFiles(node.children));
      }
      continue;
    }
    if (shouldParseFile(node)) {
      result.push(node);
    }
  }
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse all project files into minimal structural skeletons.
 * No LLM needed — pure regex/string parsing.
 */
export function buildProjectSkeleton(files: FileNode[]): ProjectSkeleton {
  const codeFiles = collectFiles(files);
  const skeletons: FileSkeleton[] = [];

  for (const f of codeFiles) {
    if (!f.content) continue;
    try {
      const skel = extractSkeleton(f.path, f.content);
      // Only include files that have meaningful content
      if (skel.functions.length || skel.types.length || skel.classes.length || skel.exports.length) {
        skeletons.push(skel);
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  const fullText = skeletons.map(s => s.compact).join('\n\n');
  const approxTokens = Math.ceil(fullText.length / 4);

  return {
    files: skeletons,
    fullText,
    approxTokens,
    generatedAt: Date.now(),
  };
}

/**
 * Build a compact skeleton that fits within a token budget.
 * Prioritizes files by number of exports (more connected = more important).
 */
export function buildBudgetedSkeleton(files: FileNode[], maxTokens: number): string {
  const skeleton = buildProjectSkeleton(files);

  if (skeleton.approxTokens <= maxTokens) {
    return skeleton.fullText;
  }

  // Sort by importance (more exports/functions = more important)
  const sorted = [...skeleton.files].sort((a, b) => {
    const scoreA = a.exports.length * 2 + a.functions.length + a.types.length;
    const scoreB = b.exports.length * 2 + b.functions.length + b.types.length;
    return scoreB - scoreA;
  });

  // Greedily add files until budget is reached
  const parts: string[] = [];
  let tokensUsed = 0;
  for (const skel of sorted) {
    const skelTokens = Math.ceil(skel.compact.length / 4);
    if (tokensUsed + skelTokens > maxTokens) continue;
    parts.push(skel.compact);
    tokensUsed += skelTokens;
  }

  return parts.join('\n\n');
}
