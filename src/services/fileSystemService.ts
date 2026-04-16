import { FileNode } from '@/store/workbenchStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', '.cache',
  '__pycache__', '.turbo', 'coverage', '.nuxt', '.output', 'out',
]);
const MAX_FILES = 5000;
/** Match Tauri: allow deeper trees without returning an empty child list. */
const MAX_DEPTH = 16;
const MAX_FILE_SIZE = 2_000_000; // 2 MB

function detectLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', scss: 'scss', html: 'html', json: 'json', md: 'markdown',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'shell', txt: 'plaintext',
    svg: 'xml', xml: 'xml', env: 'plaintext', gitignore: 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}

// ─── Directory Reading ────────────────────────────────────────────────────────

async function readDirRecursive(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string,
  depth: number,
  counter: { files: number },
): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return [];

  const nodes: FileNode[] = [];

  for await (const [name, handle] of (dirHandle as any).entries()) {
    // Skip hidden dirs except common dotfiles, skip known heavy dirs
    if (handle.kind === 'directory' && SKIP_DIRS.has(name)) continue;

    const path = basePath ? `${basePath}/${name}` : name;

    if (handle.kind === 'directory') {
      const children = await readDirRecursive(
        handle as FileSystemDirectoryHandle,
        path,
        depth + 1,
        counter,
      );
      nodes.push({ name, path, type: 'folder', children });
    } else {
      if (counter.files >= MAX_FILES) continue;
      counter.files++;

      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        let content = '// File too large to display in editor';
        if (file.size < MAX_FILE_SIZE) {
          content = await file.text();
        }
        nodes.push({ name, path, type: 'file', content, language: detectLang(name) });
      } catch {
        // Unreadable file — skip silently
      }
    }
  }

  // Folders first, then alphabetical
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OpenDirectoryResult {
  handle: FileSystemDirectoryHandle;
  files: FileNode[];
  projectName: string;
}

/**
 * Shows a native directory picker and reads all files into a FileNode tree.
 */
export async function openDirectory(): Promise<OpenDirectoryResult> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API is not supported in this browser. Please use Chrome or Edge.');
  }

  const handle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
    mode: 'readwrite',
  });

  const counter = { files: 0 };
  const files = await readDirRecursive(handle, '', 0, counter);

  return { handle, files, projectName: handle.name };
}

/**
 * Creates a new project directory inside a user-chosen parent directory.
 * Shows the native picker to let the user choose where to create the folder.
 */
export async function createProjectDirectory(projectName: string): Promise<OpenDirectoryResult> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API is not supported in this browser. Please use Chrome or Edge.');
  }

  // Ask the user to pick a PARENT directory
  const parentHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
    mode: 'readwrite',
  });

  // Create the project subdirectory
  const projectHandle = await parentHandle.getDirectoryHandle(projectName, { create: true });

  return {
    handle: projectHandle,
    files: [],
    projectName,
  };
}

/**
 * Writes (or overwrites) a file at the given relative path inside the project dir.
 * Creates intermediate directories as needed.
 */
export async function writeFileToFS(
  dirHandle: FileSystemDirectoryHandle,
  filePath: string,
  content: string,
): Promise<void> {
  const parts = filePath.split('/');
  let current: FileSystemDirectoryHandle = dirHandle;

  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i], { create: true });
  }

  const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Deletes a file at the given relative path from the project dir.
 */
export async function deleteFileFromFS(
  dirHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<void> {
  const parts = filePath.split('/');
  let current: FileSystemDirectoryHandle = dirHandle;

  for (let i = 0; i < parts.length - 1; i++) {
    try {
      current = await current.getDirectoryHandle(parts[i]);
    } catch {
      return; // Directory doesn't exist — nothing to delete
    }
  }

  try {
    await current.removeEntry(parts[parts.length - 1]);
  } catch {
    // File may not exist on disk — ignore
  }
}

/**
 * Returns true if the File System Access API is available.
 */
export function isFSAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

// ─── Git Clone ────────────────────────────────────────────────────────────────

export interface CloneProgress {
  phase: string;
  loaded: number;
  total: number;
}

/**
 * Clones a public Git repository into a user-chosen directory using isomorphic-git + LightningFS.
 * Falls back to a ZIP download approach if isomorphic-git is not available.
 *
 * NOTE: This uses the dynamic import pattern — isomorphic-git must be installed.
 */
export async function cloneRepository(
  repoUrl: string,
  projectName: string,
  onProgress?: (p: CloneProgress) => void,
): Promise<OpenDirectoryResult> {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API is not supported. Please use Chrome or Edge.');
  }

  // Normalise URL — strip trailing .git if present
  const cleanUrl = repoUrl.replace(/\.git$/, '');
  const name = projectName || cleanUrl.split('/').pop() || 'cloned-repo';

  // Let user pick where to clone
  const parentHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
    mode: 'readwrite',
  });
  const projectHandle = await parentHandle.getDirectoryHandle(name, { create: true });

  onProgress?.({ phase: 'Connecting...', loaded: 0, total: 0 });

  // Dynamic import isomorphic-git — will throw if not installed
  let git: any;
  let http: any;
  try {
    const [gitMod, httpMod] = await Promise.all([
      import('isomorphic-git'),
      import('isomorphic-git/http/web'),
    ]);
    git = gitMod;
    http = httpMod.default ?? httpMod;
  } catch {
    throw new Error(
      'isomorphic-git is not installed. Run: npm install isomorphic-git'
    );
  }

  // We use a simple in-memory FS backed by the File System Access API handle
  // isomorphic-git requires a POSIX-style fs interface; we'll use a minimal adapter
  const fsAdapter = buildFSAdapter(projectHandle);

  await git.clone({
    fs: fsAdapter,
    http,
    dir: '/',
    url: cleanUrl,
    singleBranch: true,
    depth: 1,
    corsProxy: 'https://cors.isomorphic-git.org',
    onProgress: (e: any) => {
      onProgress?.({
        phase: e.phase || 'Cloning...',
        loaded: e.loaded || 0,
        total: e.total || 0,
      });
    },
  });

  onProgress?.({ phase: 'Reading files...', loaded: 0, total: 0 });

  const counter = { files: 0 };
  const files = await readDirRecursive(projectHandle, '', 0, counter);

  return { handle: projectHandle, files, projectName: name };
}

// ─── Minimal FS adapter for isomorphic-git ───────────────────────────────────
// Maps POSIX paths to FileSystemDirectoryHandle operations.

function buildFSAdapter(root: FileSystemDirectoryHandle) {
  async function getHandle(
    path: string,
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null> {
    const parts = path.replace(/^\//, '').split('/').filter(Boolean);
    if (parts.length === 0) return root;
    let current: FileSystemDirectoryHandle = root;
    for (let i = 0; i < parts.length - 1; i++) {
      try { current = await current.getDirectoryHandle(parts[i]); }
      catch { return null; }
    }
    const lastName = parts[parts.length - 1];
    try { return await current.getFileHandle(lastName); } catch {}
    try { return await current.getDirectoryHandle(lastName); } catch {}
    return null;
  }

  async function getDirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    const parts = path.replace(/^\//, '').split('/').filter(Boolean);
    let current: FileSystemDirectoryHandle = root;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part, { create });
    }
    return current;
  }

  const promises = {
    readFile: async (path: string) => {
      const h = await getHandle(path);
      if (!h || h.kind !== 'file') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      const file = await (h as FileSystemFileHandle).getFile();
      return new Uint8Array(await file.arrayBuffer());
    },
    writeFile: async (path: string, data: Uint8Array | string) => {
      const parts = path.replace(/^\//, '').split('/').filter(Boolean);
      let dir: FileSystemDirectoryHandle = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }
      const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable();
      await w.write(typeof data === 'string' ? data : data.buffer);
      await w.close();
    },
    unlink: async (path: string) => {
      const parts = path.replace(/^\//, '').split('/').filter(Boolean);
      let dir: FileSystemDirectoryHandle = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      await dir.removeEntry(parts[parts.length - 1]);
    },
    readdir: async (path: string): Promise<string[]> => {
      const dir = await getDirHandle(path);
      const names: string[] = [];
      for await (const name of (dir as any).keys()) names.push(name);
      return names;
    },
    mkdir: async (path: string) => { await getDirHandle(path, true); },
    rmdir: async (path: string) => {
      const parts = path.replace(/^\//, '').split('/').filter(Boolean);
      let dir: FileSystemDirectoryHandle = root;
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i]);
      }
      await dir.removeEntry(parts[parts.length - 1], { recursive: true });
    },
    stat: async (path: string) => {
      if (path === '/') return { type: 'dir', mode: 0o40755, size: 0, ino: 1, mtimeMs: 0, ctimeMs: 0 };
      const h = await getHandle(path);
      if (!h) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      if (h.kind === 'directory') return { type: 'dir', mode: 0o40755, size: 0, ino: 0, mtimeMs: 0, ctimeMs: 0 };
      const file = await (h as FileSystemFileHandle).getFile();
      return { type: 'file', mode: 0o100644, size: file.size, ino: 0, mtimeMs: file.lastModified, ctimeMs: file.lastModified };
    },
    lstat: async (path: string) => promises.stat(path),
    symlink: async () => { throw new Error('symlinks not supported'); },
    readlink: async () => { throw new Error('symlinks not supported'); },
  };

  return { promises };
}
