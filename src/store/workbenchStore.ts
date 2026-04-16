import { create } from 'zustand';
import { useTaskStore } from './taskStore';
import type { EnvironmentInfo } from '@/services/environmentProbe';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
  language?: string;
}

export interface ChatImagePart {
  mediaType: string;
  dataBase64: string;
}

export type ToolInvocationStatus =
  | 'pending_user'
  | 'auto_queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';

/** OpenAI-style tool execution row (Cursor-like run_terminal_cmd). */
export interface ToolInvocation {
  id: string;
  name: string;
  argsJson: string;
  command?: string;
  status: ToolInvocationStatus;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  errorMessage?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agent?: 'orchestrator' | 'coder' | 'tester';  // which agent produced this message
  /** Inline images for multimodal chat (not persisted in full to saved history). */
  images?: ChatImagePart[];
  /** Model-requested tools (e.g. run_terminal_cmd) — desktop + approval. */
  toolInvocations?: ToolInvocation[];
  /** When true, render the inline plan card after this message. */
  showPlanCard?: boolean;
}

export interface PlanStep {
  id: string;
  action: 'create_file' | 'edit_file' | 'delete_file' | 'run_command' | 'web_search' | 'fetch_url';
  path?: string;
  command?: string;
  description: string;
  status: 'pending' | 'running' | 'repairing' | 'done' | 'error';
  /** Set when status is error — execution or verification failure reason */
  errorMessage?: string;
  /** How many repair attempts have run for this step (disciplined loop) */
  repairAttemptCount?: number;
  /** Last validation command run after this step */
  lastValidationCommand?: string;
  /** Truncated validation failure output for UI */
  lastValidationError?: string;
  /** Full diagnostic when the plan stops on this step (retry limit or stuck error) */
  stopDiagnostic?: string;
  /**
   * Why the plan stopped — used by the UI to pick appropriate colour and copy.
   * 'model'  — model-generated code caused build failure (orange/amber)
   * 'infra'  — shell unavailable, command not found, timeout (red)
   * 'stuck'  — same error repeated, model cannot make progress (orange/amber)
   */
  stopDiagnosticKind?: 'model' | 'infra' | 'stuck';
  diff?: { before: string; after: string };
  /** Last line of live output from a running shell command */
  liveOutput?: string;
  /** Full accumulated stdout from a run_command step */
  fullOutput?: string;
  /** Detected server URL (e.g. http://localhost:5173) emitted by a background process */
  serverUrl?: string;
}

export interface Plan {
  id: string;
  summary: string;
  steps: PlanStep[];
  status: 'pending' | 'approved' | 'executing' | 'done' | 'rejected';
  /** Command to run after file-changing steps to verify the project (e.g. npm run build) */
  validationCommand?: string;
}

export interface FileSnapshot {
  path: string;
  content: string | null; // null means the file didn't exist before
  action: 'created' | 'edited' | 'deleted';
}

export interface TerminalTab {
  id: string;
  name: string;
  output: string[];
}

export type AppMode = 'ask' | 'plan' | 'build' | 'chat' | 'agent';

/** Reserved center tab id for the execution plan (not a file path). */
export const CENTER_TAB_PLAN = ':plan';
/** Reserved center tab id for the benchmark panel (not a file path). */
export const CENTER_TAB_BENCHMARK = ':benchmark';

interface WorkbenchState {
  // Project
  projectName: string;
  files: FileNode[];
  dirHandle: FileSystemDirectoryHandle | null;
  /** Absolute disk path — populated when opened via Tauri, null in browser */
  projectPath: string | null;

  // Editor
  openFiles: string[];
  activeFile: string | null;
  activeCenterTab: 'chat' | typeof CENTER_TAB_PLAN | string;  // chat, plan tab, or file path

  // AI
  mode: AppMode;
  messages: ChatMessage[];
  currentPlan: Plan | null;
  /** When false, Plan tab is hidden but currentPlan may still exist (show “Open plan” in chat). */
  planTabOpen: boolean;
  /** Incremented when chat session is replaced (new/load) so AIPanel clears streaming UI */
  chatSessionEpoch: number;

  // Terminal
  terminalTabs: TerminalTab[];
  activeTerminalId: string;
  terminalOutput: string[];  // kept for backward compat — points to active tab

  // Logs
  logs: { time: string; message: string; type: 'info' | 'success' | 'error' | 'warning' }[];

  // Rollback
  fileHistory: FileSnapshot[];

  /** Probed environment — set on project open, available to all agents */
  envInfo: EnvironmentInfo | null;

  // Streaming / Token Power Grid stats (written by AIPanel, read by TokenPowerGrid)
  /** True while the model is actively streaming a response */
  aiIsStreaming: boolean;
  /** Live tokens-per-second rate, null when not streaming */
  aiLiveTokPerSec: number | null;
  /** Accumulated total tokens consumed this session (across all turns) */
  aiSessionTotalTokens: number;
  /** Date.now() timestamp of when the first message was sent in this session */
  aiSessionStartTime: number | null;
  /** Estimated current context window usage in tokens */
  aiContextUsed: number;
  /** Current context window limit for the active model */
  aiContextLimit: number;
  setAiStreamingStats: (patch: {
    isStreaming?: boolean;
    liveTokPerSec?: number | null;
    contextUsed?: number;
    contextLimit?: number;
  }) => void;
  /** Call when a turn completes — adds the turn's token count to the session total */
  addAiSessionTokens: (tokens: number) => void;
  /** Called when a new session starts (bumpChatSession) — resets session counters */
  resetAiSessionStats: () => void;

  // Actions
  setEnvInfo: (info: EnvironmentInfo | null) => void;
  setActiveFile: (path: string) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveCenterTab: (tab: 'chat' | typeof CENTER_TAB_PLAN | string) => void;
  setPlanTabOpen: (open: boolean) => void;
  openPlanTab: () => void;
  closePlanTab: () => void;
  setMode: (mode: AppMode) => void;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  /** Deep-merge a message by id (e.g. update tool invocation status). */
  updateMessage: (id: string, fn: (prev: ChatMessage) => ChatMessage) => void;
  setCurrentPlan: (plan: Plan | null) => void;
  updatePlanStatus: (status: Plan['status']) => void;
  updateStepStatus: (stepId: string, status: PlanStep['status'], errorMessage?: string) => void;
  /** Merge fields into a plan step (retry counts, diagnostics, validation metadata). */
  updatePlanStep: (stepId: string, patch: Partial<PlanStep>) => void;
  updateStepLiveOutput: (stepId: string, line: string) => void;
  updateStepServerUrl: (stepId: string, url: string) => void;
  addTerminalOutput: (line: string) => void;
  clearTerminal: () => void;
  addTerminalTab: () => void;
  removeTerminalTab: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  addLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  updateFileContent: (path: string, content: string) => void;
  setMessages: (messages: ChatMessage[]) => void;
  /** New chat / load chat — bumps epoch, resets task orchestrator UI */
  bumpChatSession: () => void;
  setProjectName: (name: string) => void;
  setDirHandle: (handle: FileSystemDirectoryHandle | null) => void;
  setProjectPath: (path: string | null) => void;
  setFiles: (files: FileNode[]) => void;

  // File operations
  createFile: (path: string, content: string, language?: string) => void;
  deleteFile: (path: string) => void;
  getFileContent: (path: string) => string | undefined;

  // Rollback
  pushSnapshot: (snapshot: FileSnapshot) => void;
  clearHistory: () => void;
  rollbackFile: (path: string) => void;
  rollbackAll: () => void;
}

// ─── Language detection ──────────────────────────────────────────────────────

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    css: 'css', scss: 'scss', html: 'html', json: 'json', md: 'markdown',
    py: 'python', rs: 'rust', go: 'go', java: 'java', yml: 'yaml', yaml: 'yaml',
    toml: 'toml', sh: 'shell', bash: 'shell', txt: 'plaintext',
  };
  return langMap[ext || ''] || 'plaintext';
}

// ─── Tree helpers ────────────────────────────────────────────────────────────

function findFile(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findFile(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function insertFileInTree(nodes: FileNode[], filePath: string, content: string, language: string): FileNode[] {
  const segments = filePath.split('/');
  return insertAtDepth(nodes, segments, 0, filePath, content, language);
}

// Walks the tree by segment depth, always using full paths for node identity.
function insertAtDepth(
  nodes: FileNode[],
  segments: string[],
  depth: number,
  fullPath: string,
  content: string,
  language: string,
): FileNode[] {
  if (depth === segments.length - 1) {
    // File level — insert or update
    const exists = nodes.some(n => n.path === fullPath && n.type === 'file');
    if (exists) {
      return nodes.map(n => n.path === fullPath ? { ...n, content, language } : n);
    }
    return [...nodes, { name: segments[depth], path: fullPath, type: 'file', content, language }];
  }

  // Folder level — full path of this folder is the first (depth+1) segments
  const folderPath = segments.slice(0, depth + 1).join('/');
  const existingIdx = nodes.findIndex(n => n.path === folderPath && n.type === 'folder');

  if (existingIdx >= 0) {
    return nodes.map((n, i) =>
      i === existingIdx
        ? { ...n, children: insertAtDepth(n.children || [], segments, depth + 1, fullPath, content, language) }
        : n,
    );
  }

  // Folder doesn't exist yet — build the full remaining structure at once
  return [...nodes, buildNestedFromDepth(segments, depth, fullPath, content, language)];
}

function buildNestedFromDepth(
  segments: string[],
  depth: number,
  fullPath: string,
  content: string,
  language: string,
): FileNode {
  const currentPath = segments.slice(0, depth + 1).join('/');
  const name = segments[depth];

  if (depth === segments.length - 1) {
    return { name, path: fullPath, type: 'file', content, language };
  }

  return {
    name,
    path: currentPath,
    type: 'folder',
    children: [buildNestedFromDepth(segments, depth + 1, fullPath, content, language)],
  };
}

function removeFileFromTree(nodes: FileNode[], filePath: string): FileNode[] {
  return nodes
    .filter(n => n.path !== filePath)
    .map(n => {
      if (n.children) {
        return { ...n, children: removeFileFromTree(n.children, filePath) };
      }
      return n;
    });
}

// ─── Store ───────────────────────────────────────────────────────────────────
// Default empty tree until a project folder is bound (see syncWorkbenchFromProject + launcher).

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  projectName: '',
  files: [],
  dirHandle: null,
  projectPath: null,
  envInfo: null,
  openFiles: [],
  activeFile: null,
  activeCenterTab: 'chat',
  mode: (localStorage.getItem('scout-mode') as AppMode) || 'agent',
  messages: [
    { id: '1', role: 'assistant', agent: 'orchestrator', content: "Describe what you want to build and I'll create a step-by-step plan.\n\nI can search the web, fetch docs, write code, and run commands.", timestamp: Date.now() }
  ],
  currentPlan: null,
  planTabOpen: false,
  chatSessionEpoch: 0,
  terminalTabs: [{ id: 'term-1', name: 'Terminal 1', output: ['$ Ready.'] }],
  activeTerminalId: 'term-1',
  terminalOutput: ['$ Ready.'],
  logs: [{ time: new Date().toLocaleTimeString(), message: 'Workbench initialized', type: 'info' }],
  fileHistory: [],

  // Streaming / Token Power Grid stats
  aiIsStreaming: false,
  aiLiveTokPerSec: null,
  aiSessionTotalTokens: 0,
  aiSessionStartTime: null,
  aiContextUsed: 0,
  aiContextLimit: 0,
  setAiStreamingStats: (patch) => set(s => ({
    aiIsStreaming: patch.isStreaming ?? s.aiIsStreaming,
    aiLiveTokPerSec: patch.liveTokPerSec !== undefined ? patch.liveTokPerSec : s.aiLiveTokPerSec,
    aiContextUsed: patch.contextUsed ?? s.aiContextUsed,
    aiContextLimit: patch.contextLimit ?? s.aiContextLimit,
  })),
  addAiSessionTokens: (tokens) => set(s => ({
    aiSessionTotalTokens: s.aiSessionTotalTokens + tokens,
    aiSessionStartTime: s.aiSessionStartTime ?? Date.now(),
  })),
  resetAiSessionStats: () => set({
    aiSessionTotalTokens: 0,
    aiSessionStartTime: null,
    aiIsStreaming: false,
    aiLiveTokPerSec: null,
  }),

  setActiveFile: (path) => set({ activeFile: path }),
  setActiveCenterTab: (tab) => {
    if (tab === 'chat') {
      set({ activeCenterTab: 'chat' });
      return;
    }
    if (tab === CENTER_TAB_PLAN) {
      set({ activeCenterTab: CENTER_TAB_PLAN, planTabOpen: true });
      return;
    }
    if (tab === CENTER_TAB_BENCHMARK) {
      set({ activeCenterTab: CENTER_TAB_BENCHMARK });
      return;
    }
    // Opening a file tab — also set activeFile so the editor shows the right content
    const { openFiles } = get();
    if (!openFiles.includes(tab)) {
      set({ openFiles: [...openFiles, tab], activeFile: tab, activeCenterTab: tab });
    } else {
      set({ activeFile: tab, activeCenterTab: tab });
    }
  },
  setPlanTabOpen: (open) => set({ planTabOpen: open }),
  openPlanTab: () => set({ planTabOpen: true, activeCenterTab: CENTER_TAB_PLAN }),
  closePlanTab: () =>
    set(s => ({
      planTabOpen: false,
      activeCenterTab: s.activeCenterTab === CENTER_TAB_PLAN ? 'chat' : s.activeCenterTab,
    })),
  openFile: (path) => {
    const { openFiles } = get();
    if (!openFiles.includes(path)) {
      set({ openFiles: [...openFiles, path], activeFile: path, activeCenterTab: path });
    } else {
      set({ activeFile: path, activeCenterTab: path });
    }
  },
  closeFile: (path) => {
    const { openFiles, activeFile, activeCenterTab } = get();
    const next = openFiles.filter(f => f !== path);
    const newActiveFile = activeFile === path ? (next[next.length - 1] || null) : activeFile;
    const newCenterTab = activeCenterTab === path
      ? (next.length > 0 ? next[next.length - 1] : 'chat')
      : activeCenterTab;
    set({ openFiles: next, activeFile: newActiveFile, activeCenterTab: newCenterTab });
  },
  setMode: (mode) => { localStorage.setItem('scout-mode', mode); set({ mode }); },
  addMessage: (msg) => set(s => ({
    messages: [...s.messages, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }]
  })),
  updateMessage: (id, fn) =>
    set(s => ({
      messages: s.messages.map(m => (m.id === id ? fn(m) : m)),
    })),
  setCurrentPlan: (plan) =>
    set(s => {
      if (!plan) {
        return {
          currentPlan: null,
          planTabOpen: false,
          activeCenterTab: s.activeCenterTab === CENTER_TAB_PLAN ? 'chat' : s.activeCenterTab,
        };
      }
      // Open the Plan tab so it's available, but don't auto-navigate away from Chat.
      // The user can click the Plan tab if they want to inspect it.
      return {
        currentPlan: plan,
        planTabOpen: true,
      };
    }),
  updatePlanStatus: (status) => set(s => ({
    currentPlan: s.currentPlan ? { ...s.currentPlan, status } : null
  })),
  updateStepStatus: (stepId, status, errorMessage) => set(s => ({
    currentPlan: s.currentPlan ? {
      ...s.currentPlan,
      steps: s.currentPlan.steps.map(step =>
        step.id === stepId
          ? {
              ...step,
              status,
              errorMessage:
                status === 'error'
                  ? (errorMessage?.trim() || 'This step failed (no message was recorded).')
                  : undefined,
            }
          : step
      )
    } : null
  })),
  updatePlanStep: (stepId, patch) => set(s => ({
    currentPlan: s.currentPlan
      ? {
          ...s.currentPlan,
          steps: s.currentPlan.steps.map(step =>
            step.id === stepId ? { ...step, ...patch } : step,
          ),
        }
      : null,
  })),
  updateStepLiveOutput: (stepId, line) => set(s => ({
    currentPlan: s.currentPlan ? {
      ...s.currentPlan,
      steps: s.currentPlan.steps.map(step =>
        step.id === stepId ? { ...step, liveOutput: line, fullOutput: (step.fullOutput ?? '') + line + '\n' } : step
      ),
    } : null,
  })),
  updateStepServerUrl: (stepId, url) => set(s => ({
    currentPlan: s.currentPlan ? {
      ...s.currentPlan,
      steps: s.currentPlan.steps.map(step =>
        step.id === stepId ? { ...step, serverUrl: url } : step
      ),
    } : null,
  })),
  addTerminalOutput: (line) => set(s => {
    const tabs = s.terminalTabs.map(t =>
      t.id === s.activeTerminalId ? { ...t, output: [...t.output, line] } : t
    );
    const active = tabs.find(t => t.id === s.activeTerminalId);
    return { terminalTabs: tabs, terminalOutput: active?.output || s.terminalOutput };
  }),
  clearTerminal: () => set(s => {
    const tabs = s.terminalTabs.map(t =>
      t.id === s.activeTerminalId ? { ...t, output: ['$ Ready.'] } : t
    );
    return { terminalTabs: tabs, terminalOutput: ['$ Ready.'] };
  }),
  addTerminalTab: () => set(s => {
    const num = s.terminalTabs.length + 1;
    const id = `term-${Date.now()}`;
    const tab: TerminalTab = { id, name: `Terminal ${num}`, output: ['$ Ready.'] };
    return {
      terminalTabs: [...s.terminalTabs, tab],
      activeTerminalId: id,
      terminalOutput: tab.output,
    };
  }),
  removeTerminalTab: (id) => set(s => {
    if (s.terminalTabs.length <= 1) return s; // keep at least one
    const tabs = s.terminalTabs.filter(t => t.id !== id);
    const newActive = s.activeTerminalId === id ? tabs[tabs.length - 1].id : s.activeTerminalId;
    const activeTab = tabs.find(t => t.id === newActive);
    return {
      terminalTabs: tabs,
      activeTerminalId: newActive,
      terminalOutput: activeTab?.output || ['$ Ready.'],
    };
  }),
  setActiveTerminal: (id) => set(s => {
    const tab = s.terminalTabs.find(t => t.id === id);
    return { activeTerminalId: id, terminalOutput: tab?.output || s.terminalOutput };
  }),
  addLog: (message, type = 'info') => set(s => ({
    logs: [...s.logs, { time: new Date().toLocaleTimeString(), message, type }]
  })),
  setMessages: (messages) => set({ messages }),
  bumpChatSession: () => {
    useTaskStore.getState().resetTask();
    set(s => ({
      chatSessionEpoch: s.chatSessionEpoch + 1,
      aiSessionTotalTokens: 0,
      aiSessionStartTime: null,
      aiIsStreaming: false,
      aiLiveTokPerSec: null,
    }));
  },
  setProjectName: (name) => set({ projectName: name }),
  setDirHandle: (handle) => set({ dirHandle: handle }),
  setProjectPath: (path) => set({ projectPath: path }),
  setEnvInfo: (info) => set({ envInfo: info }),
  setFiles: (files) => set({ files }),
  updateFileContent: (path, content) => set(s => {
    const updateContent = (nodes: FileNode[]): FileNode[] =>
      nodes.map(n => {
        if (n.path === path) return { ...n, content };
        if (n.children) return { ...n, children: updateContent(n.children) };
        return n;
      });
    return { files: updateContent(s.files) };
  }),

  // ─── File operations ─────────────────────────────────────────────────────

  createFile: (path, content, language) => {
    const lang = language || detectLanguage(path);
    set(s => ({
      files: insertFileInTree(s.files, path, content, lang),
    }));
  },

  deleteFile: (path) => {
    set(s => ({
      files: removeFileFromTree(s.files, path),
      openFiles: s.openFiles.filter(f => f !== path),
      activeFile: s.activeFile === path ? (s.openFiles.filter(f => f !== path)[0] || null) : s.activeFile,
    }));
  },

  getFileContent: (path) => {
    const file = findFile(get().files, path);
    return file?.content;
  },

  // ─── Rollback ────────────────────────────────────────────────────────────

  pushSnapshot: (snapshot) => set(s => ({
    fileHistory: [...s.fileHistory, snapshot],
  })),

  clearHistory: () => set({ fileHistory: [] }),

  rollbackFile: (path) => {
    const { fileHistory } = get();
    // Find the most recent snapshot for this path
    const snapshot = [...fileHistory].reverse().find(s => s.path === path);
    if (!snapshot) return;

    if (snapshot.action === 'created') {
      // File was created by agent — delete it to rollback
      get().deleteFile(path);
    } else if (snapshot.action === 'edited' && snapshot.content !== null) {
      // File was edited — restore previous content
      get().updateFileContent(path, snapshot.content);
    } else if (snapshot.action === 'deleted' && snapshot.content !== null) {
      // File was deleted — recreate it
      get().createFile(path, snapshot.content);
    }

    // Remove this snapshot from history
    set(s => ({
      fileHistory: s.fileHistory.filter(h => h !== snapshot),
    }));
  },

  rollbackAll: () => {
    const { fileHistory } = get();
    // Rollback in reverse order
    const snapshots = [...fileHistory].reverse();
    for (const snapshot of snapshots) {
      if (snapshot.action === 'created') {
        get().deleteFile(snapshot.path);
      } else if (snapshot.action === 'edited' && snapshot.content !== null) {
        get().updateFileContent(snapshot.path, snapshot.content);
      } else if (snapshot.action === 'deleted' && snapshot.content !== null) {
        get().createFile(snapshot.path, snapshot.content);
      }
    }
    set({ fileHistory: [] });
  },
}));
