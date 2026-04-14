/**
 * Pure utility functions extracted from AIPanel.
 * No React state — safe to import anywhere.
 */

import type { ModelProvider } from '@/store/modelStore';
import type { AppMode } from '@/store/workbenchStoreTypes';
import { normalizeActivityLine } from '@/utils/activityLineNormalize';

export const MAX_TOOL_ROUNDS = 8;
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 512 * 1024;

export const modeOptions: { key: AppMode; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'agent', label: 'Agent' },
];

export const AGENT_META: Record<string, { label: string; color: string }> = {
  orchestrator: { label: 'Orchestrator', color: 'text-accent' },
  coder:        { label: 'Coder',        color: 'text-primary' },
};

/**
 * Header badge for the in-flight agent card. `agentLoopStatus` is often a shell / verify line
 * (`$ …`, `Verifying:`) that does not mention Coder — fall back to the latest role hints in history.
 */
/** File-oriented tools common in the coder phase after orchestrator delegation. */
const CODER_PHASE_TOOL = /^→\s+(read_file|write_to_file|search_files|list_dir|multi_edit|delete_file|grep)\b/i;

export function inferWorkbenchAgentRole(status: string, history: string[]): 'coder' | 'orchestrator' {
  const s = normalizeActivityLine(status).trim();
  if (/^Coder\b/i.test(s) || /^Coder:/i.test(s)) return 'coder';
  if (/^Orchestrator\b/i.test(s)) return 'orchestrator';

  let lastDelegationIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = normalizeActivityLine(history[i]);
    if (/^→\s+delegate_to_coder\b/i.test(h) || /^Delegate to coder/i.test(h)) {
      lastDelegationIdx = i;
      break;
    }
  }

  for (let i = history.length - 1; i >= 0; i--) {
    const h = normalizeActivityLine(history[i]);
    if (/^\$ |^Verifying:|^Installing|^Auto-install|^Streaming ·/i.test(h)) continue;
    if (lastDelegationIdx >= 0 && i > lastDelegationIdx && CODER_PHASE_TOOL.test(h)) return 'coder';
    if (/^Coder · .+ · round \d+/i.test(h)) return 'coder';
    if (/^Coder r\d/i.test(h)) return 'coder';
    if (/^→\s+delegate_to_coder\b/i.test(h)) return 'coder';
    if (/^Delegate to coder/i.test(h)) return 'coder';
    if (/^Orchestrator · .+ · round \d+/i.test(h)) return 'orchestrator';
    if (/^Round \d+/i.test(h)) return 'orchestrator';
  }
  return 'orchestrator';
}

export function providerSupportsNativeTools(provider: ModelProvider): boolean {
  return provider !== 'anthropic';
}

export function visionAllowedForProvider(p: ModelProvider): boolean {
  return p !== 'google';
}

export const formatTokenCount = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ─── File attachment helpers ─────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'html', 'htm', 'svg',
  'py', 'rs', 'go', 'java', 'kt', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'prisma', 'proto',
  'env', 'env.local', 'env.example', 'gitignore', 'dockerignore',
  'dockerfile', 'makefile', 'cmake',
  'log', 'diff', 'patch',
]);

export type PendingImage = {
  id: string;
  mediaType: string;
  dataBase64: string;
  previewUrl: string;
};

export type PendingTextFile = {
  id: string;
  fileName: string;
  textContent: string;
};

export type PendingAttachment = { kind: 'image'; data: PendingImage } | { kind: 'text'; data: PendingTextFile };

export function isTextFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const nameLC = file.name.toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || nameLC === 'dockerfile' || nameLC === 'makefile' ||
    nameLC === '.gitignore' || nameLC === '.env' || file.type.startsWith('text/');
}

export function readFileAsAttachment(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Only image files are supported'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('Image too large (max 4 MB)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const m = res.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) {
        reject(new Error('Could not read image'));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        mediaType: m[1],
        dataBase64: m[2],
        previewUrl: URL.createObjectURL(file),
      });
    };
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

export function readTextFileAsAttachment(file: File): Promise<PendingTextFile> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_TEXT_FILE_BYTES) {
      reject(new Error(`File too large: ${file.name} (max 512 KB)`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        fileName: file.name,
        textContent: reader.result as string,
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

// ─── Stream progress detection ───────────────────────────────────────────────

export function detectStreamProgress(content: string): string {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const tail = lines.slice(-5);
  const lastNonEmpty = tail.filter(l => l.trim()).at(-1) || '';

  const fenceCount = (content.match(/```/g) || []).length;
  const inCode = fenceCount % 2 === 1;

  if (inCode) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/^```(\w+)?/);
      if (m) {
        const lang = m[1];
        const codeLines = lines.slice(i + 1);
        const lastCode = codeLines.filter(l => l.trim()).at(-1) || '';

        const fn = lastCode.match(/(?:function|const|let|def|fn|func|pub fn)\s+(\w+)/);
        if (fn) return `Writing \`${fn[1]}()\``;

        const cls = lastCode.match(/(?:class|interface|struct|enum)\s+(\w+)/);
        if (cls) return `Defining \`${cls[1]}\``;

        const comp = lastCode.match(/(?:export\s+)?(?:function|const)\s+([A-Z]\w+)/);
        if (comp) return `Building \`<${comp[1]} />\``;

        if (lastCode.match(/import\s|from\s|require\(/)) return 'Adding imports';

        const codeLen = codeLines.join('\n').length;
        if (lang) return `Writing ${lang} (${codeLen} chars)`;
        return `Writing code (${codeLen} chars)`;
      }
    }
  }

  const closedBlocks = Math.floor(fenceCount / 2);

  const headingMatch = lastNonEmpty.match(/^#{1,3}\s+(.+)/);
  if (headingMatch) return headingMatch[1].slice(0, 50);

  const stepMatch = lastNonEmpty.match(/^\s*(\d+)\.\s+\*?\*?(.+?)\*?\*?\s*$/);
  if (stepMatch) return `Step ${stepMatch[1]}: ${stepMatch[2].slice(0, 40)}`;

  const fileMatch = tail.join(' ').match(/`([^`]{2,60}\.\w{1,6})`/);
  if (fileMatch) return `Working on \`${fileMatch[1]}\``;

  const words = content.split(/\s+/).length;
  if (closedBlocks > 0) return `Generated ${closedBlocks} code block${closedBlocks > 1 ? 's' : ''}, ${words} words`;
  if (totalLines > 10) return `Generating response (${words} words)`;

  return 'Thinking...';
}

// ─── Activity feed helpers ───────────────────────────────────────────────────

export type ActivityItem = { id: string; text: string; done: boolean };

export const ACTIVITY_ICONS: Record<string, string> = {
  'Indexed':    '📂',
  'Connecting': '🔌',
  'Sending':    '📤',
  'Receiving':  '📡',
  'Parsing':    '🔍',
  'Plan ready': '✅',
  'Executing':  '⚙️',
  'Step':       '▶',
};

export function extractStepCount(text: string): number {
  const m = text.match(/(\d+)\s+step/);
  return m ? parseInt(m[1], 10) : 0;
}

export function extractTokPerSec(text: string): string | null {
  const m = text.match(/(\d+)\s+tok\/s/);
  return m ? m[1] : null;
}

export function activityIcon(text: string): string {
  for (const [prefix, icon] of Object.entries(ACTIVITY_ICONS)) {
    if (text.startsWith(prefix)) return icon;
  }
  return '⚙️';
}

/** Human-readable wall time for live counters. */
export function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const totalMin = Math.floor(sec / 60);
  const remSec = Math.round(sec - totalMin * 60);
  const sPart = remSec >= 60 ? 59 : remSec;
  if (totalMin < 60) return `${totalMin}m ${sPart}s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Exact duration for tooltips. */
export function fmtElapsedExact(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
