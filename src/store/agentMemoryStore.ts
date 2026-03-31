/**
 * Agent Memory Store — persistent memory across sessions.
 *
 * Remembers:
 * - Decisions made (architectural choices, library picks, patterns adopted)
 * - User preferences (coding style, tool preferences, language)
 * - Work history (what was built, key files created/modified)
 * - Errors encountered and how they were resolved
 *
 * Persisted to localStorage via Zustand. Cross-platform.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isTauri } from '@/lib/tauri';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { writeAgentMemoryToDisk, resolveEffectiveRoot } from '@/services/memoryManager';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MemoryCategory =
  | 'decision'      // Architectural or design decisions
  | 'preference'    // User preferences and style
  | 'work'          // What was built, files created
  | 'error'         // Errors and their resolutions
  | 'context'       // General project context
  | 'install'       // Package installation outcomes
  | 'build_outcome' // Build/validation outcomes
  | 'fix'           // Successful repair fixes (written by repair loop)
  | 'error_fix';    // Full repair ledger summary (written by repair loop)

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  /** Short title for quick scanning */
  title: string;
  /** Full content — injected into agent prompts */
  content: string;
  /** Project this memory belongs to (or '*' for global) */
  projectName: string;
  /** When this was created */
  createdAt: number;
  /** When this was last accessed / confirmed still relevant */
  lastAccessedAt: number;
  /** Relevance score (higher = more important, decays over time) */
  relevance: number;
  /** Tags for filtering */
  tags: string[];
  /** Whether the action succeeded or failed */
  outcome?: 'success' | 'failure';
}

const MEMORY_CATEGORIES: ReadonlySet<string> = new Set([
  'decision', 'preference', 'work', 'error', 'context', 'install', 'build_outcome',
  'fix', 'error_fix',
]);

function isValidMemoryEntry(x: unknown): x is MemoryEntry {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.category === 'string' &&
    MEMORY_CATEGORIES.has(o.category) &&
    typeof o.title === 'string' &&
    typeof o.content === 'string' &&
    typeof o.projectName === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.lastAccessedAt === 'number' &&
    typeof o.relevance === 'number' &&
    Array.isArray(o.tags) &&
    (o.tags as unknown[]).every(t => typeof t === 'string')
  );
}

/** Fire-and-forget sync of current project's memories to `.codescout/memory.json`. */
function scheduleAgentMemoryDiskWrite() {
  queueMicrotask(() => {
    void (async () => {
      if (!isTauri()) return;
      const wb = useWorkbenchStore.getState();
      const base = wb.projectPath;
      if (!base) return;
      const root = resolveEffectiveRoot(base, wb.files);
      const name = wb.projectName;
      const projectMems = useAgentMemoryStore.getState().memories.filter(m => m.projectName === name);
      await writeAgentMemoryToDisk(root, projectMems);
    })();
  });
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max memories per project before pruning */
const MAX_MEMORIES_PER_PROJECT = 100;
/** Max total token budget for memories injected into prompts */
const MAX_MEMORY_PROMPT_TOKENS = 1500;
/** Relevance decay: lose 10% per day */
const RELEVANCE_DECAY_PER_DAY = 0.1;

// ─── Store ───────────────────────────────────────────────────────────────────

interface AgentMemoryState {
  memories: MemoryEntry[];

  /** Add a new memory entry */
  addMemory: (entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt' | 'relevance'>) => void;
  /** Record a command execution outcome (install, build, etc.) */
  recordCommandOutcome: (projectName: string, command: string, success: boolean, errorSnippet?: string, resolution?: string) => void;
  /** Update an existing memory */
  updateMemory: (id: string, updates: Partial<Pick<MemoryEntry, 'title' | 'content' | 'tags' | 'relevance'>>) => void;
  /** Remove a memory */
  removeMemory: (id: string) => void;
  /** Get memories for a project (includes global '*' memories) */
  getProjectMemories: (projectName: string) => MemoryEntry[];
  /** Get memories by category */
  getByCategory: (projectName: string, category: MemoryCategory) => MemoryEntry[];
  /** Search memories by keyword */
  searchMemories: (projectName: string, query: string) => MemoryEntry[];
  /** Build a prompt-ready string of relevant memories for a project */
  buildMemoryPrompt: (projectName: string, maxTokens?: number) => string;
  /** Record that a memory was used (updates lastAccessedAt, boosts relevance) */
  touchMemory: (id: string) => void;
  /** Prune old/low-relevance memories for a project */
  pruneMemories: (projectName: string) => void;
  /** Clear all memories for a project */
  clearProject: (projectName: string) => void;
  /** Merge entries from `.codescout/memory.json` (ids not already present). */
  mergeMemoriesFromDisk: (raw: unknown[]) => void;
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function decayedRelevance(entry: MemoryEntry): number {
  const daysSinceAccess = (Date.now() - entry.lastAccessedAt) / (1000 * 60 * 60 * 24);
  return entry.relevance * Math.pow(1 - RELEVANCE_DECAY_PER_DAY, daysSinceAccess);
}

export const useAgentMemoryStore = create<AgentMemoryState>()(
  persist(
    (set, get) => ({
      memories: [],

      addMemory: (entry) => {
        const newEntry: MemoryEntry = {
          ...entry,
          id: generateId(),
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
          relevance: 1.0,
        };
        set(s => ({ memories: [...s.memories, newEntry] }));
        // Auto-prune if over limit
        get().pruneMemories(entry.projectName);
        scheduleAgentMemoryDiskWrite();
      },

      recordCommandOutcome: (projectName, command, success, errorSnippet, resolution) => {
        const cmdShort = command.slice(0, 80);
        const isInstall = /^(npm|yarn|pnpm|bun|pip|pip3|cargo|go get|composer|bundle|gem|dotnet|brew)\s+(install|add|i|get)\b/i.test(command.trim());
        const isBuild = /^(npm|yarn|pnpm|bun)\s+run\s+build|cargo build|go build|mvn compile|gradle build/i.test(command.trim());

        const category: MemoryCategory = isInstall ? 'install' : isBuild ? 'build_outcome' : success ? 'work' : 'error';
        const outcome: 'success' | 'failure' = success ? 'success' : 'failure';

        let content = `Command: \`${cmdShort}\` — ${success ? 'succeeded' : 'failed'}`;
        if (!success && errorSnippet) content += `\nError: ${errorSnippet.slice(0, 300)}`;
        if (resolution) content += `\nFixed by: ${resolution}`;

        const tags = [
          success ? 'success' : 'failure',
          isInstall ? 'install' : isBuild ? 'build' : 'command',
        ];

        get().addMemory({
          category,
          title: `${success ? '✓' : '✗'} ${cmdShort}`,
          content,
          projectName,
          tags,
          outcome,
        });
      },

      updateMemory: (id, updates) => {
        set(s => ({
          memories: s.memories.map(m =>
            m.id === id ? { ...m, ...updates, lastAccessedAt: Date.now() } : m,
          ),
        }));
        scheduleAgentMemoryDiskWrite();
      },

      removeMemory: (id) => {
        set(s => ({
          memories: s.memories.filter(m => m.id !== id),
        }));
        scheduleAgentMemoryDiskWrite();
      },

      getProjectMemories: (projectName) => {
        return get().memories.filter(
          m => m.projectName === projectName || m.projectName === '*',
        );
      },

      getByCategory: (projectName, category) => {
        return get().getProjectMemories(projectName).filter(m => m.category === category);
      },

      searchMemories: (projectName, query) => {
        const lower = query.toLowerCase();
        return get().getProjectMemories(projectName).filter(m =>
          m.title.toLowerCase().includes(lower) ||
          m.content.toLowerCase().includes(lower) ||
          m.tags.some(t => t.toLowerCase().includes(lower)),
        );
      },

      buildMemoryPrompt: (projectName, maxTokens = MAX_MEMORY_PROMPT_TOKENS) => {
        const memories = get().getProjectMemories(projectName);
        if (!memories.length) return '';

        // Sort by decayed relevance
        const sorted = [...memories]
          .map(m => ({ ...m, score: decayedRelevance(m) }))
          .sort((a, b) => b.score - a.score);

        const lines: string[] = ['## Agent Memory'];
        let tokensUsed = 10; // header overhead

        for (const m of sorted) {
          const line = `- [${m.category}] ${m.title}: ${m.content}`;
          const lineTokens = Math.ceil(line.length / 4);
          if (tokensUsed + lineTokens > maxTokens) break;
          lines.push(line);
          tokensUsed += lineTokens;
        }

        if (lines.length <= 1) return ''; // only header, no memories fit
        return lines.join('\n');
      },

      touchMemory: (id) => set(s => ({
        memories: s.memories.map(m =>
          m.id === id
            ? { ...m, lastAccessedAt: Date.now(), relevance: Math.min(2.0, m.relevance + 0.1) }
            : m,
        ),
      })),

      pruneMemories: (projectName) => set(s => {
        const projectMems = s.memories.filter(
          m => m.projectName === projectName,
        );
        if (projectMems.length <= MAX_MEMORIES_PER_PROJECT) return s;

        // Remove lowest relevance memories
        const sorted = projectMems
          .map(m => ({ id: m.id, score: decayedRelevance(m) }))
          .sort((a, b) => a.score - b.score);

        const toRemove = new Set(
          sorted.slice(0, projectMems.length - MAX_MEMORIES_PER_PROJECT).map(m => m.id),
        );

        return {
          memories: s.memories.filter(m => !toRemove.has(m.id)),
        };
      }),

      clearProject: (projectName) => {
        set(s => ({
          memories: s.memories.filter(m => m.projectName !== projectName),
        }));
        scheduleAgentMemoryDiskWrite();
      },

      mergeMemoriesFromDisk: (raw) => {
        const entries = raw.filter(isValidMemoryEntry);
        if (entries.length === 0) return;
        set(s => {
          const byId = new Map(s.memories.map(m => [m.id, m]));
          for (const e of entries) {
            if (!byId.has(e.id)) byId.set(e.id, e);
          }
          return { memories: Array.from(byId.values()) };
        });
      },
    }),
    {
      name: 'coder-scout-agent-memory',
    },
  ),
);

// ─── Helper: extract memories from assistant responses ───────────────────────

/**
 * Parse an assistant message for things worth remembering.
 * Called after each successful agent turn.
 */
export function extractMemoriesFromResponse(
  projectName: string,
  userMessage: string,
  assistantMessage: string,
  toolsUsed: string[],
): Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt' | 'relevance'>[] {
  const memories: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessedAt' | 'relevance'>[] = [];

  // Detect file creation
  if (toolsUsed.includes('write_to_file')) {
    const fileMatches = assistantMessage.match(/(?:created?|wrote?|writing)\s+(?:file\s+)?[`"]?([^\s`"]+\.\w+)[`"]?/gi);
    if (fileMatches) {
      for (const match of fileMatches) {
        const fileMatch = match.match(/[`"]?([^\s`"]+\.\w+)[`"]?$/);
        if (fileMatch) {
          memories.push({
            category: 'work',
            title: `Created ${fileMatch[1]}`,
            content: `File ${fileMatch[1]} was created. Context: ${userMessage.slice(0, 100)}`,
            projectName,
            tags: ['file-creation', fileMatch[1]],
          });
        }
      }
    }
  }

  // Detect dependency installation
  const depMatch = assistantMessage.match(/(?:installed?|adding)\s+(?:dependencies?|packages?)\s*:?\s*([^\n.]+)/i);
  if (depMatch) {
    memories.push({
      category: 'decision',
      title: `Dependencies: ${depMatch[1].slice(0, 60)}`,
      content: `Installed: ${depMatch[1]}. Reason: ${userMessage.slice(0, 100)}`,
      projectName,
      tags: ['dependencies'],
    });
  }

  // Detect architectural decisions (patterns like "I'll use X", "chose X over Y")
  const decisionPatterns = [
    /(?:I'll|let's|we'll|going to)\s+use\s+(\w[\w\s]+?)(?:\s+(?:for|to|because|instead))/i,
    /chose\s+(\w[\w\s]+?)\s+(?:over|instead of)\s+(\w[\w\s]+)/i,
  ];
  for (const pat of decisionPatterns) {
    const m = assistantMessage.match(pat);
    if (m) {
      memories.push({
        category: 'decision',
        title: `Decision: ${m[0].slice(0, 60)}`,
        content: m[0].slice(0, 200),
        projectName,
        tags: ['architecture', 'decision'],
      });
      break; // one decision per response is enough
    }
  }

  // Detect error resolutions
  if (toolsUsed.includes('run_terminal_cmd')) {
    const errorFix = assistantMessage.match(/(?:fixed|resolved|the (?:issue|error|problem) was)\s+(.{10,100})/i);
    if (errorFix) {
      memories.push({
        category: 'error',
        title: `Fix: ${errorFix[1].slice(0, 60)}`,
        content: `${errorFix[0].slice(0, 200)}. Original request: ${userMessage.slice(0, 80)}`,
        projectName,
        tags: ['error-resolution'],
      });
    }
  }

  return memories;
}
