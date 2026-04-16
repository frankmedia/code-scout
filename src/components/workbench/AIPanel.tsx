import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Square, Loader2, Brain, AlertCircle, ChevronDown, ImagePlus, Paperclip, FileCode, X, CheckCircle2, Circle, Cloud, Network, Search, Mic, MicOff } from 'lucide-react';
import { useWorkbenchStore, AppMode, type ChatImagePart } from '@/store/workbenchStore';
import { useModelStore, PROVIDER_OPTIONS, ModelProvider } from '@/store/modelStore';
import { useChatHistoryStore } from '@/store/chatHistoryStore';
import {
  callModel,
  modelToRequest,
  ModelRequestMessage,
  TokenUsage,
  type CallModelDoneMeta,
} from '@/services/modelApi';
import { chatMessagesToApiMessages } from '@/services/chatApiMessages';
import { ALL_CHAT_TOOLS, invocationsFromToolCalls, parseTextToolCalls } from '@/services/chatTools';
import { generateMockPlan } from '@/services/planGenerator';
import { orchestrator } from '@/services/orchestrator';
import { registerPlanRevisionHandler } from '@/services/planRevisionBridge';
import { getWebResearchContext } from '@/services/agentExecutor';
import { getOrIndexProject, getBudgetedSkeletonText, resolveEffectiveRoot } from '@/services/memoryManager';
import { buildInstallContext } from '@/services/installTracker';
import { formatEnvForPrompt } from '@/services/environmentProbe';
import { useProjectMemoryStore } from '@/store/projectMemoryStore';
import { compressMessages } from '@/services/contextCompressor';
import { useAgentMemoryStore, extractMemoriesFromResponse } from '@/store/agentMemoryStore';
import {
  estimateThreadTokens,
  contextLimitForModel,
  getChatSystemPrompt,
  getAgentSystemPrompt,
  roughTokensFromRequestMessages,
  roughTokensFromText,
} from '@/utils/tokenEstimate';
import { runAgentToolLoop } from '@/services/agentToolLoop';
import { isTauri } from '@/lib/tauri';
import { effectiveSupportsVision } from '@/config/modelVisionHeuristics';
// modelContextFetcher is called via the store's refreshModelStats action
import { ChatMarkdown } from './ChatMarkdown';
import { ChatToolInvocations } from './ChatToolInvocations';
import { ChatPlanCard } from './ChatPlanCard';
import { EscalationDialog } from './EscalationDialog';

const MAX_TOOL_ROUNDS = 8;

/** Cloud icon for API providers, Network/LAN icon for local servers. */
export const ProviderIcon = ({
  isLocal,
  className = 'h-3.5 w-3.5',
}: {
  isLocal: boolean;
  className?: string;
}) =>
  isLocal
    ? <Network className={className} aria-hidden />
    : <Cloud className={className} aria-hidden />;

function providerSupportsNativeTools(provider: ModelProvider): boolean {
  // Anthropic uses a different tool format (handled separately in callAnthropic).
  // All other providers (OpenAI, Ollama, LM Studio, etc.) support OpenAI-style tools.
  return provider !== 'anthropic';
}

const modeOptions: { key: AppMode; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'agent', label: 'Agent' },
];

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;


const AGENT_META: Record<string, { label: string; color: string }> = {
  orchestrator: { label: 'Orchestrator', color: 'text-accent' },
  coder:        { label: 'Coder',         color: 'text-primary' },
  tester:       { label: 'Tester',        color: 'text-warning' },
};

const AgentLabel = ({ agent, thinking }: { agent: string; thinking?: boolean }) => {
  const meta = AGENT_META[agent] ?? { label: agent, color: 'text-muted-foreground' };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium mb-1 pl-0.5 ${meta.color}`}>
      {thinking && agent === 'orchestrator' && (
        <Brain className="h-2.5 w-2.5 animate-pulse shrink-0" aria-hidden />
      )}
      {thinking && agent !== 'orchestrator' && (
        <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" aria-hidden />
      )}
      {meta.label}
    </span>
  );
};

const formatTokenCount = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

// ─── Context usage bar ────────────────────────────────────────────────────────

function ContextBar({
  used,
  limit,
  onNewChat,
}: {
  used: number;
  limit: number;
  onNewChat: () => void;
}) {
  if (limit <= 0) return null;
  const ratio = Math.min(1, used / limit);
  const pct = Math.round(ratio * 100);
  const danger = ratio >= 0.9;
  const warn = ratio >= 0.8;
  const fillClass = danger ? 'bg-destructive' : warn ? 'bg-warning' : 'bg-primary/70';
  const labelClass = danger ? 'text-destructive' : warn ? 'text-warning' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-2 min-w-0 shrink-0" title={`~${formatTokenCount(used)} of ${formatTokenCount(limit)} tokens used in this conversation`}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className={`text-[10px] font-mono tabular-nums whitespace-nowrap ${labelClass}`}>
          ~{formatTokenCount(used)} / {formatTokenCount(limit)}
        </span>
        <div className="h-1 w-24 rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${fillClass}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {warn && (
        <button
          type="button"
          onClick={onNewChat}
          className={`text-[10px] font-medium shrink-0 hover:underline transition-colors ${danger ? 'text-destructive' : 'text-warning'}`}
          title="Context window is nearly full — start a fresh conversation"
        >
          New chat →
        </button>
      )}
    </div>
  );
}


// ─── Compact model dropdown only ─────────────────────────────────────────────

const ModelDropdown = () => {
  const { models, selectedChatModel, setSelectedChatModel } = useModelStore();
  const getModelForRole = useModelStore(s => s.getModelForRole);
  const [open, setOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setModelSearch('');
      queueMicrotask(() => modelSearchInputRef.current?.focus());
    }
  }, [open]);

  const enabledModels = models.filter(m => m.enabled);

  // Identify the "starred" models so we can badge + sort them
  const orchestratorModel = getModelForRole('orchestrator');
  const coderModel = getModelForRole('coder');
  const ROLE_SORT: Record<string, number> = {};
  if (orchestratorModel) ROLE_SORT[orchestratorModel.id] = 0;
  if (coderModel && coderModel.id !== orchestratorModel?.id) ROLE_SORT[coderModel.id] = 1;

  const modelSearchNeedle = modelSearch.trim().toLowerCase();
  const filteredChatModels = useMemo(() => {
    const enabled = models.filter(m => m.enabled);
    const matched = modelSearchNeedle
      ? enabled.filter(m => {
          const prov = PROVIDER_OPTIONS.find(p => p.id === m.provider)?.label ?? '';
          return (
            m.name.toLowerCase().includes(modelSearchNeedle)
            || m.modelId.toLowerCase().includes(modelSearchNeedle)
            || prov.toLowerCase().includes(modelSearchNeedle)
          );
        })
      : enabled;
    // Sort: orchestrator first, then coder, then the rest alphabetically
    return [...matched].sort((a, b) => {
      const ra = ROLE_SORT[a.id] ?? 99;
      const rb = ROLE_SORT[b.id] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, modelSearchNeedle, orchestratorModel?.id, coderModel?.id]);

  // The model that will actually be used right now
  const effectiveModel = selectedChatModel
    ? models.find(m => m.id === selectedChatModel)
    : orchestratorModel;

  const currentModel = effectiveModel;
  const displayName = currentModel ? currentModel.modelId : 'No model';
  const currentProvider = currentModel
    ? PROVIDER_OPTIONS.find(p => p.id === currentModel.provider)
    : null;
  const currentRoleLabel = currentModel?.role === 'orchestrator' ? '🧠' : currentModel?.role === 'coder' ? '💻' : null;

  return (
    <div className="relative shrink-0 w-[min(100%,408px)] max-w-[66vw]" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full min-h-[40px] rounded-md bg-secondary border border-border px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors text-left"
      >
        {currentProvider && (
          <ProviderIcon isLocal={currentProvider.isLocal} className="h-4 w-4 shrink-0" />
        )}
        <span className="font-mono truncate min-w-0 flex-1 text-[13px]" title={displayName}>{displayName}</span>
        {currentRoleLabel && (
          <span className="text-[11px] shrink-0 opacity-70">{currentRoleLabel}</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-[504px] bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border space-y-2">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Select Model</p>
            {enabledModels.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  ref={modelSearchInputRef}
                  type="search"
                  value={modelSearch}
                  onChange={e => setModelSearch(e.target.value)}
                  placeholder="Search models…"
                  className="w-full bg-secondary border border-border rounded-md pl-8 pr-2 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  aria-label="Filter chat models"
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                />
              </div>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto py-1">
            <button
              onClick={() => { setSelectedChatModel(null); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] hover:bg-surface-hover transition-colors ${
                !selectedChatModel ? 'bg-primary/10 text-primary' : 'text-foreground'
              }`}
            >
              <span className="text-sm">🔄</span>
              <div className="flex-1 text-left">
                <span className="font-medium">Auto</span>
                <span className="text-muted-foreground ml-1.5 text-[11px]">
                  {orchestratorModel ? `→ ${orchestratorModel.name}` : 'Uses Orchestrator model'}
                </span>
              </div>
              {!selectedChatModel && <span className="text-primary">✓</span>}
            </button>
            <div className="border-t border-border my-1" />
            {filteredChatModels.map(m => {
              const provider = PROVIDER_OPTIONS.find(p => p.id === m.provider);
              const isOrchestrator = m.id === orchestratorModel?.id;
              const isCoder = m.id === coderModel?.id;
              const isActive = m.id === effectiveModel?.id;
              const isManuallySelected = selectedChatModel === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => { setSelectedChatModel(m.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-4 py-3 text-[13px] hover:bg-surface-hover transition-colors ${
                    isManuallySelected
                      ? 'bg-primary/10 text-primary'
                      : isActive
                        ? 'bg-success/8 text-foreground'
                        : 'text-foreground'
                  }`}
                >
                  {provider
                    ? <ProviderIcon isLocal={provider.isLocal} className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <span className="text-sm">·</span>
                  }
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate text-[13px]">{m.name}</span>
                      {isOrchestrator && (
                        <span className="shrink-0 px-1 py-0.5 rounded text-[10px] bg-accent/20 text-accent font-medium">🧠 Orchestrator</span>
                      )}
                      {isCoder && !isOrchestrator && (
                        <span className="shrink-0 px-1 py-0.5 rounded text-[10px] bg-primary/15 text-primary font-medium">💻 Coder</span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {provider?.label} · {m.modelId}
                    </span>
                  </div>
                  {isManuallySelected
                    ? <span className="text-primary shrink-0">✓</span>
                    : isActive
                      ? <span className="text-success shrink-0 text-[10px] font-medium">active</span>
                      : null
                  }
                </button>
              );
            })}
            {enabledModels.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">No models enabled. Configure in Settings.</p>
            )}
            {enabledModels.length > 0 && filteredChatModels.length === 0 && modelSearchNeedle && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">No models match your search.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

type PendingImage = {
  id: string;
  mediaType: string;
  dataBase64: string;
  previewUrl: string;
};

type PendingTextFile = {
  id: string;
  fileName: string;
  textContent: string;
};

type PendingAttachment = { kind: 'image'; data: PendingImage } | { kind: 'text'; data: PendingTextFile };

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

const MAX_TEXT_FILE_BYTES = 512 * 1024; // 512 KB

function isTextFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const nameLC = file.name.toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || nameLC === 'dockerfile' || nameLC === 'makefile' ||
    nameLC === '.gitignore' || nameLC === '.env' || file.type.startsWith('text/');
}

function readFileAsAttachment(file: File): Promise<PendingImage> {
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

function readTextFileAsAttachment(file: File): Promise<PendingTextFile> {
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

function visionAllowedForProvider(p: ModelProvider): boolean {
  return p !== 'google';
}

// ─── Stream progress detection ───────────────────────────────────────────────

/**
 * Analyze streaming content to produce a short, dynamic progress description.
 * Focuses on the LATEST activity (last ~5 lines), not the whole response.
 */
function detectStreamProgress(content: string): string {
  const lines = content.split('\n');
  const totalLines = lines.length;
  // Only look at the last few lines for "what's happening right now"
  const tail = lines.slice(-5);
  const lastNonEmpty = tail.filter(l => l.trim()).at(-1) || '';

  // Check if currently inside a code block (odd number of ```)
  const fenceCount = (content.match(/```/g) || []).length;
  const inCode = fenceCount % 2 === 1;

  if (inCode) {
    // Find the latest code fence to get language
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(/^```(\w+)?/);
      if (m) {
        const lang = m[1];
        const codeLines = lines.slice(i + 1);
        const lastCode = codeLines.filter(l => l.trim()).at(-1) || '';

        // Detect specific constructs in the last code line
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

  // Count completed code blocks
  const closedBlocks = Math.floor(fenceCount / 2);

  // Detect headings / steps
  const headingMatch = lastNonEmpty.match(/^#{1,3}\s+(.+)/);
  if (headingMatch) return headingMatch[1].slice(0, 50);

  const stepMatch = lastNonEmpty.match(/^\s*(\d+)\.\s+\*?\*?(.+?)\*?\*?\s*$/);
  if (stepMatch) return `Step ${stepMatch[1]}: ${stepMatch[2].slice(0, 40)}`;

  // Detect file path mentions in recent text
  const fileMatch = tail.join(' ').match(/`([^`]{2,60}\.\w{1,6})`/);
  if (fileMatch) return `Working on \`${fileMatch[1]}\``;

  // Show aggregate progress
  const words = content.split(/\s+/).length;
  if (closedBlocks > 0) return `Generated ${closedBlocks} code block${closedBlocks > 1 ? 's' : ''}, ${words} words`;
  if (totalLines > 10) return `Generating response (${words} words)`;

  return 'Thinking...';
}

// ─── Activity feed (shown while the orchestrator is planning) ────────────────

type ActivityItem = { id: string; text: string; done: boolean };

const ACTIVITY_ICONS: Record<string, string> = {
  'Indexed':    '📂',
  'Connecting': '🔌',
  'Sending':    '📤',
  'Receiving':  '📡',
  'Parsing':     '🔍',
  'Plan ready':  '✅',
  'Executing':   '⚙️',
  'Step':        '▶',
};

/** Extract "N steps found" count from a Receiving activity line. */
function extractStepCount(text: string): number {
  const m = text.match(/(\d+)\s+step/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Extract tok/s rate from a Receiving activity line. */
function extractTokPerSec(text: string): string | null {
  const m = text.match(/(\d+)\s+tok\/s/);
  return m ? m[1] : null;
}

function activityIcon(text: string): string {
  for (const [prefix, icon] of Object.entries(ACTIVITY_ICONS)) {
    if (text.startsWith(prefix)) return icon;
  }
  return '⚙️';
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const PlanActivityFeed = ({
  activities,
  elapsedMs,
}: {
  activities: ActivityItem[];
  elapsedMs: number;
}) => {
  if (activities.length === 0) return null;
  const isActive = activities.some(a => !a.done);
  return (
    <div className="w-full min-w-0">
      <AgentLabel agent="orchestrator" thinking={isActive} />
      <div className="rounded-lg overflow-hidden bg-card border border-border/40 text-[11px]">
        {/* header */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 bg-secondary/40">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Orchestrator activity
          </span>
          {isActive && (
            <span className="ml-auto font-mono text-primary/70 tabular-nums">
              {fmtElapsed(elapsedMs)}
            </span>
          )}
        </div>
        {/* event rows */}
        <div className="px-3 py-2 space-y-1.5 font-mono">
          {activities.map((a) => {
            const isReceiving = a.text.startsWith('Receiving ·');
            const stepCount = isReceiving ? extractStepCount(a.text) : 0;
            const tokPerSec = isReceiving ? extractTokPerSec(a.text) : null;

            // Split "Receiving · ~370 tokens · 12 tok/s · 3 steps found" into parts
            const mainLabel = isReceiving
              ? a.text.split(' · ').slice(0, 2).join(' · ')   // "Receiving · ~370 tokens"
              : a.text;
            const badges: string[] = [];
            if (tokPerSec) badges.push(`${tokPerSec} tok/s`);
            if (stepCount > 0) badges.push(`${stepCount} step${stepCount !== 1 ? 's' : ''} found`);

            return (
              <div key={a.id} className={`transition-all duration-300 ${a.done ? 'opacity-35' : 'opacity-100'}`}>
                <div className="flex items-center gap-2">
                  {a.done ? (
                    <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 text-primary shrink-0 animate-pulse" />
                  )}
                  <span className="shrink-0 leading-none">{activityIcon(a.text)}</span>
                  <span className={a.done ? 'text-muted-foreground' : 'text-foreground'}>
                    {mainLabel}
                  </span>
                  {badges.map(b => (
                    <span
                      key={b}
                      className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-primary/15 text-primary font-sans"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── Main AI Panel ───────────────────────────────────────────────────────────

const AIPanel = () => {
  const store = useWorkbenchStore();
  const {
    messages,
    addMessage,
    setCurrentPlan,
    addLog,
    mode,
    setMode,
    files,
    projectName,
    chatSessionEpoch,
    currentPlan,
    planTabOpen,
    openPlanTab,
    bumpChatSession,
  } = store;
  const getModelForRole = useModelStore(s => s.getModelForRole);
  const getSelectedChatModel = useModelStore(s => s.getSelectedChatModel);
  const updateModel = useModelStore(s => s.updateModel);
  const { saveCurrentChat } = useChatHistoryStore();
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [planActivities, setPlanActivities] = useState<ActivityItem[]>([]);
  const [thinkingElapsedMs, setThinkingElapsedMs] = useState(0);
  /** Live token totals for the current thinking/streaming turn (from provider callbacks). */
  const [liveTurnTokens, setLiveTurnTokens] = useState({ in: 0, out: 0 });
  /** Live tokens-per-second rate computed from streaming chunks. */
  const [liveTokPerSec, setLiveTokPerSec] = useState<number | null>(null);
  const streamFirstChunkAtRef = useRef<number>(0);
  const streamCharsReceivedRef = useRef<number>(0);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [pendingTextFiles, setPendingTextFiles] = useState<PendingTextFile[]>([]);
  const requestStartTime = useRef<number>(0);
  const thinkingStartMsRef = useRef<number>(0);
  const planHadError = useRef(false);
  /** Last `userGoal` string passed to the planner that produced the current pending plan (for revisions). */
  const lastSubmittedPlannerGoalRef = useRef('');
  const runPlanningWithUserGoalRef = useRef<(userGoal: string) => Promise<void>>(async () => {});
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // ── Voice input: MediaRecorder → macOS SFSpeechRecognizer (Apple native, free) ──
  // webkitSpeechRecognition does not work in Tauri's WKWebView — the host app
  // must authorise SFSpeechRecognizer natively, which we now do via a Rust/Swift
  // Tauri command (transcribe_audio_native). MediaRecorder + getUserMedia work
  // fine for capture. We prefer audio/mp4 (AAC) which SFSpeechRecognizer reads
  // directly; webm requires an ffmpeg conversion step in the Rust side.
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const isListeningRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const insertAtRef = useRef<number | null>(null);

  const transcribeAudio = useCallback(async (blob: Blob, insertAt: number | null) => {
    setIsTranscribing(true);
    let transcript = '';
    try {
      // Convert blob → base64 in chunks (avoids call-stack overflow on large files)
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < uint8.length; i += CHUNK) {
        binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK));
      }
      const audioBase64 = btoa(binary);
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';

      // ── macOS SFSpeechRecognizer via Tauri native command (Apple native) ──
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<string>('transcribe_audio_native', { audioBase64, ext });
      transcript = result.trim();
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)) ?? '';
      if (msg.includes('ERR:not_authorized') || msg.includes('ERR:restricted')) {
        setVoiceError('Speech recognition not authorised — go to System Settings → Privacy & Security → Speech Recognition and enable Code Scout.');
      } else if (msg.includes('ERR:recognizer_unavailable')) {
        setVoiceError('macOS speech recogniser not available. Check your internet connection (required for first-time setup).');
      } else if (msg.includes('ERR:sidecar_not_found') || msg.includes('ERR:sidecar_exit')) {
        setVoiceError('Voice helper not built — rebuild the app (requires Xcode Command Line Tools: xcode-select --install).');
      } else if (msg.includes('ERR:timeout')) {
        setVoiceError('Transcription timed out — try speaking again.');
      } else if (msg.includes('ERR:file_not_found')) {
        setVoiceError('Audio recording was empty — try again.');
      } else {
        setVoiceError(`Transcription failed: ${msg.replace(/^ERR:[^:]+:?/, '').slice(0, 140)}`);
      }
      return;
    } finally {
      setIsTranscribing(false);
      setTimeout(() => textareaRef.current?.focus(), 80);
    }

    if (transcript) {
      let newCursor = 0;
      setInput(prev => {
        const pos = insertAt ?? prev.length;
        const before = prev.slice(0, pos);
        const after = prev.slice(pos);
        const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
        const suffix = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
        const insertion = prefix + transcript + suffix;
        newCursor = pos + insertion.length;
        return before + insertion + after;
      });
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) { el.focus(); el.setSelectionRange(newCursor, newCursor); }
      });
    }
  }, [setInput]);

  const toggleVoice = useCallback(async () => {
    setVoiceError(null);

    if (isListeningRef.current) {
      insertAtRef.current = textareaRef.current?.selectionStart ?? null;
      mediaRecorderRef.current?.stop();
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError('Microphone access denied — allow it in System Settings → Privacy & Security → Microphone.');
      return;
    }

    micStreamRef.current = stream;
    audioChunksRef.current = [];
    insertAtRef.current = textareaRef.current?.selectionStart ?? null;

    // Prefer audio/mp4 (AAC) — SFSpeechRecognizer handles it without conversion.
    // Fall back to whatever the browser supports (usually audio/webm).
    const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
      : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };

    recorder.onstop = () => {
      isListeningRef.current = false;
      setIsListening(false);
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      audioChunksRef.current = [];
      mediaRecorderRef.current = null;
      void transcribeAudio(blob, insertAtRef.current);
    };

    recorder.onerror = () => {
      isListeningRef.current = false;
      setIsListening(false);
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
      mediaRecorderRef.current = null;
    };

    recorder.start();
    isListeningRef.current = true;
    setIsListening(true);
  }, [transcribeAudio]);

  const pendingImagesRef = useRef<PendingImage[]>([]);
  pendingImagesRef.current = pendingImages;
  const toolRoundDepthRef = useRef(0);
  const tryContinueToolChainRef = useRef<(messageId: string) => void>(() => {});
  /** Holds real token usage received mid-stream; consumed exactly once in onDone. */
  const pendingStreamUsage = useRef<TokenUsage | null>(null);
  /** Abort current chat / tool-chain / summary stream when user hits Stop. */
  const chatStreamAbortRef = useRef<AbortController | null>(null);
  const isThinkingRef = useRef(false);
  isThinkingRef.current = isThinking;

  const prevMessageCountRef = useRef(0);

  /**
   * Auto-scroll strategy:
   * - Message COUNT increases (new message added): always scroll to bottom.
   * - Existing message updated (tool-invocation status change etc.): don't scroll.
   * - Streaming chunk arrived: only scroll if user is already near the bottom (≤150 px),
   *   so they can freely scroll up to read earlier content while a response streams in.
   */
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const newCount = messages.length;
    if (newCount > prevMessageCountRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCountRef.current = newCount;
  }, [messages]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom <= 150) el.scrollTop = el.scrollHeight;
  }, [streamingContent]);

  // When the chat tab becomes active again (after being hidden), restore scroll to bottom.
  const activeCenterTab = useWorkbenchStore(s => s.activeCenterTab);
  useEffect(() => {
    if (activeCenterTab !== 'chat') return;
    const el = messagesScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeCenterTab]);

  const applyTokenUsage = useCallback((usage: TokenUsage) => {
    if (!isThinkingRef.current) return;
    const inn = usage.inputTokens ?? 0;
    const out = usage.outputTokens ?? 0;
    if (inn <= 0 && out <= 0) return;
    setLiveTurnTokens(prev => ({
      in: Math.max(prev.in, inn),
      out: Math.max(prev.out, out),
    }));
  }, []);

  /** Called on every streamed chunk to update the live tok/s counter. */
  const trackStreamChunk = useCallback((chunk: string) => {
    const now = Date.now();
    if (streamFirstChunkAtRef.current === 0) {
      streamFirstChunkAtRef.current = now;
      streamCharsReceivedRef.current = 0;
    }
    streamCharsReceivedRef.current += chunk.length;
    const elapsedSec = (now - streamFirstChunkAtRef.current) / 1000;
    if (elapsedSec > 0.5) {
      const approxTokens = streamCharsReceivedRef.current / 4;
      setLiveTokPerSec(Math.round(approxTokens / elapsedSec));
    }
  }, []);

  useEffect(() => {
    setIsThinking(false);
    setStreamingContent('');
    setStreamError(null);
    setPlanActivities([]);
    setThinkingElapsedMs(0);
    setLiveTurnTokens({ in: 0, out: 0 });
    setLiveTokPerSec(null);
    streamFirstChunkAtRef.current = 0;
    streamCharsReceivedRef.current = 0;
    planHadError.current = false;
    lastSubmittedPlannerGoalRef.current = '';
    chatStreamAbortRef.current?.abort();
    chatStreamAbortRef.current = null;
  }, [chatSessionEpoch]);

  const prevIsThinkingRef = useRef(false);
  useEffect(() => {
    if (isThinking && !prevIsThinkingRef.current) {
      setLiveTurnTokens({ in: 0, out: 0 });
      setLiveTokPerSec(null);
      streamFirstChunkAtRef.current = 0;
      streamCharsReceivedRef.current = 0;
    }
    prevIsThinkingRef.current = isThinking;
  }, [isThinking]);

  // Live elapsed-time counter while thinking
  useEffect(() => {
    if (!isThinking) { setThinkingElapsedMs(0); return; }
    thinkingStartMsRef.current = Date.now();
    const iv = setInterval(() => {
      setThinkingElapsedMs(Date.now() - thinkingStartMsRef.current);
    }, 200);
    return () => clearInterval(iv);
  }, [isThinking]);

  /**
   * Smart activity pusher.
   * If the new status begins with the same word as the current (last) activity,
   * it updates in-place (e.g. "Receiving · 100 chars" → "Receiving · 200 chars").
   * Otherwise it marks the current entry done and appends a new one.
   */
  const pushOrUpdateActivity = useCallback((text: string) => {
    setPlanActivities(prev => {
      const last = prev.at(-1);
      const newPrefix = text.split('·')[0].trim();
      if (last && !last.done && last.text.split('·')[0].trim() === newPrefix) {
        // Same phase — update in place
        return prev.map((a, i) => i === prev.length - 1 ? { ...a, text } : a);
      }
      // New phase — mark previous done and push
      const marked = prev.map((a, i) =>
        i === prev.length - 1 ? { ...a, done: true } : a,
      );
      return [...marked, { id: crypto.randomUUID(), text, done: false }];
    });
  }, []);

  useEffect(() => () => {
    pendingImagesRef.current.forEach(p => URL.revokeObjectURL(p.previewUrl));
  }, []);

  // Document-level paste listener — WebKit (Tauri/macOS) does not surface image
  // data through clipboardData.items on <textarea> elements, only on contenteditable.
  // Listening at the document level captures it reliably.
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (document.activeElement !== textareaRef.current) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      if (!imageItems.length) return;
      e.preventDefault();
      const totalAttachments = pendingImagesRef.current.length + pendingTextFiles.length;
      const room = MAX_ATTACHMENTS - totalAttachments;
      if (room <= 0) { setStreamError(`At most ${MAX_ATTACHMENTS} attachments.`); return; }
      try {
        const newImages: PendingImage[] = [];
        for (const item of imageItems.slice(0, room)) {
          const file = item.getAsFile();
          if (file) newImages.push(await readFileAsAttachment(file));
        }
        if (newImages.length) { setPendingImages(prev => [...prev, ...newImages]); setStreamError(null); }
      } catch (err) {
        setStreamError(err instanceof Error ? err.message : 'Could not paste image');
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [pendingTextFiles.length]);

  const getActiveModel = (forRole: 'orchestrator' | 'coder' | 'tester' = 'orchestrator') => {
    const manual = getSelectedChatModel();
    if (manual) return manual;
    return getModelForRole(forRole) ?? getModelForRole('orchestrator');
  };

  const projectPath = useWorkbenchStore(s => s.projectPath);
  const planExecuting = useWorkbenchStore(s => s.currentPlan?.status === 'executing');
  const isAgentBusy = isThinking || planExecuting;
  const chatRoleForEstimate: 'orchestrator' | 'coder' =
    mode === 'agent' || mode === 'build' || planExecuting ? 'coder' : 'orchestrator';
  const estimateModel = getActiveModel(chatRoleForEstimate);

  // Refresh stats for the active model whenever it changes.
  // Uses a 10-min cooldown via statsRefreshedAt to avoid hammering the API.
  const refreshModelStats = useModelStore(s => s.refreshModelStats);
  useEffect(() => {
    if (!estimateModel) return;
    const COOLDOWN_MS = 10 * 60 * 1000;
    const age = estimateModel.statsRefreshedAt ? Date.now() - estimateModel.statsRefreshedAt : Infinity;
    if (age < COOLDOWN_MS) return;
    void refreshModelStats(estimateModel.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimateModel?.id]);

  const contextLimit = contextLimitForModel(estimateModel);
  const toolsEnabledForEstimate =
    isTauri() &&
    !!projectPath &&
    !!estimateModel &&
    providerSupportsNativeTools(estimateModel.provider);
  const systemPromptForEstimate = getChatSystemPrompt(chatRoleForEstimate, isTauri(), {
    toolsEnabled: toolsEnabledForEstimate,
  });

  const estimatedContext = useMemo(
    () =>
      estimateThreadTokens(
        messages,
        systemPromptForEstimate,
        input,
        isThinking ? streamingContent : '',
      ),
    [messages, systemPromptForEstimate, input, isThinking, streamingContent],
  );

  const showImageAttach =
    !!estimateModel && effectiveSupportsVision(estimateModel) && visionAllowedForProvider(estimateModel.provider);

  const handlePickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = '';
    if (!list?.length) return;
    const files = Array.from(list);
    const totalAttachments = pendingImages.length + pendingTextFiles.length;
    const room = MAX_ATTACHMENTS - totalAttachments;
    if (room <= 0) {
      setStreamError(`At most ${MAX_ATTACHMENTS} attachments.`);
      return;
    }
    const toAdd = files.slice(0, room);
    try {
      const newImages: PendingImage[] = [];
      const newTextFiles: PendingTextFile[] = [];
      for (const f of toAdd) {
        if (f.type.startsWith('image/')) {
          newImages.push(await readFileAsAttachment(f));
        } else if (isTextFile(f)) {
          newTextFiles.push(await readTextFileAsAttachment(f));
        } else {
          // Try reading as text anyway for unknown types under size limit
          if (f.size <= MAX_TEXT_FILE_BYTES) {
            try {
              newTextFiles.push(await readTextFileAsAttachment(f));
            } catch {
              setStreamError(`Unsupported file type: ${f.name}`);
            }
          } else {
            setStreamError(`Unsupported or too large: ${f.name}`);
          }
        }
      }
      if (newImages.length) setPendingImages(prev => [...prev, ...newImages]);
      if (newTextFiles.length) setPendingTextFiles(prev => [...prev, ...newTextFiles]);
      setStreamError(null);
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Could not add file');
    }
  };

  const removePendingImage = (id: string) => {
    setPendingImages(prev => {
      const img = prev.find(p => p.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  };

  const removePendingTextFile = (id: string) => {
    setPendingTextFiles(prev => prev.filter(p => p.id !== id));
  };

  const beginChatStream = () => {
    chatStreamAbortRef.current?.abort();
    chatStreamAbortRef.current = new AbortController();
    return chatStreamAbortRef.current.signal;
  };

  const handleStop = () => {
    chatStreamAbortRef.current?.abort();
    orchestrator.cancelTask();
    setStreamingContent('');
    setIsThinking(false);
    const st = useWorkbenchStore.getState();
    if (st.currentPlan?.status === 'executing') {
      st.updatePlanStatus('done');
    }
    addLog('Stopped by user', 'warning');
  };

  type SendFlow = 'plan' | 'chat_orchestrator' | 'chat_coder';
  type PrepareSendResult =
    | { ok: true; userMsg: string; images?: ChatImagePart[]; flow: SendFlow }
    | { ok: false; error: string };

  const prepareSendPayload = (): PrepareSendResult => {
    const text = input.trim();
    const hasImages = pendingImages.length > 0;
    const hasTextFiles = pendingTextFiles.length > 0;
    if (!text && !hasImages && !hasTextFiles) {
      return { ok: false, error: 'Nothing to send' };
    }
    const planExec = useWorkbenchStore.getState().currentPlan?.status === 'executing';
    const isChat = mode === 'chat' || mode === 'ask';
    const isAgent = mode === 'agent' || mode === 'build' || mode === 'plan';
    const modelForSend =
      isChat
        ? getActiveModel('orchestrator')
        : isAgent || planExec
          ? getActiveModel('coder')
          : getActiveModel('orchestrator');

    if (hasImages) {
      if (!modelForSend || !effectiveSupportsVision(modelForSend)) {
        return {
          ok: false,
          error:
            'This model is not set up for images — pick **Images in chat: Auto or Always on** in Settings, or use a vision model id (*-vl, llava, …).',
        };
      }
      if (!visionAllowedForProvider(modelForSend.provider)) {
        return { ok: false, error: 'Image attachments are not supported for this provider in the app yet.' };
      }
    }

    let messageContent = text;
    if (hasTextFiles) {
      const fileParts = pendingTextFiles.map(f =>
        `\n\n---\n**Attached file: \`${f.fileName}\`**\n\`\`\`\n${f.textContent}\n\`\`\``,
      ).join('');
      messageContent = (text || '(see attached files)') + fileParts;
    }
    const userMsg = messageContent || '(see images)';
    const imageParts = hasImages
      ? pendingImages.map(p => ({ mediaType: p.mediaType, dataBase64: p.dataBase64 }))
      : undefined;

    let flow: SendFlow;
    if (isChat) flow = 'chat_orchestrator';
    else if (planExec) flow = 'chat_coder';
    else flow = 'plan';

    return { ok: true, userMsg, images: imageParts, flow };
  };

  const fakePlanDelay = () => new Promise(r => setTimeout(r, 1000));

  const clearComposerAfterSend = () => {
    setInput('');
    setStreamError(null);
    setPlanActivities([]);
    pendingImages.forEach(p => URL.revokeObjectURL(p.previewUrl));
    setPendingImages([]);
    setPendingTextFiles([]);
  };

  const handleSend = async () => {
    const prep = prepareSendPayload();
    if (!prep.ok) {
      if (prep.error !== 'Nothing to send') setStreamError(prep.error);
      return;
    }
    if (isAgentBusy) return;

    clearComposerAfterSend();

    addMessage({ role: 'user', content: prep.userMsg, images: prep.images });
    setIsThinking(true);
    requestStartTime.current = Date.now();

    if (prep.flow === 'chat_orchestrator') {
      // Use the multi-round agent tool loop when both orchestrator and coder models
      // are configured and a project path is open; otherwise fall back to single-shot chat.
      const ms = useModelStore.getState();
      const hasCoderModel = !!(ms.getModelForRole('coder')?.enabled);
      const hasProjectPath = !!useWorkbenchStore.getState().projectPath;
      if (hasCoderModel && hasProjectPath && isTauri()) {
        await handleAgentToolLoop(prep.userMsg);
      } else {
        await handleChatResponse(prep.userMsg, 'orchestrator');
      }
    } else if (prep.flow === 'chat_coder') {
      await handleChatResponse(prep.userMsg, 'coder');
    } else {
      await handlePlanGeneration(prep.userMsg);
    }

    saveCurrentChat(useWorkbenchStore.getState().messages);
  };

  runPlanningWithUserGoalRef.current = async (userGoal: string) => {
    const model = getActiveModel('orchestrator');

    if (!model || !model.enabled) {
      await fakePlanDelay();
      // Even for mock plans, index the project so we get correct paths & identity
      const mockMemory = getOrIndexProject(files, projectName);
      const mockFlat: typeof files = [];
      const mockWalk = (nodes: typeof files) => { for (const n of nodes) { if (n.type === 'file') mockFlat.push(n); if (n.children) mockWalk(n.children); } };
      mockWalk(files);
      const mockIdentity = {
        framework: mockMemory.repoMap.framework,
        packageManager: mockMemory.repoMap.packageManager,
        language: mockMemory.repoMap.primaryLanguage,
        styling: mockMemory.conventions.styling !== 'N/A' ? mockMemory.conventions.styling : undefined,
        entryPoints: mockMemory.repoMap.entryPoints,
        runCommands: mockMemory.repoMap.runCommands,
        hasExistingProject: mockFlat.some(f => /\.(jsx?|tsx?|py|rs|go)$/.test(f.path)) || mockFlat.some(f => f.name === 'package.json'),
      };
      const plan = generateMockPlan(userGoal, mockIdentity, files);
      setCurrentPlan(plan);
      const mockStepLines = plan.steps.map((s, i) => {
        const icon = s.action === 'run_command' ? '`$`' : s.action === 'create_file' ? '`+`' : s.action === 'delete_file' ? '`-`' : '`~`';
        const target = s.command ? `\`${s.command}\`` : s.path ? `\`${s.path}\`` : '';
        return `${i + 1}. ${icon} ${s.description}${target ? ' — ' + target : ''}`;
      }).join('\n');
      addMessage({
        role: 'assistant',
        agent: 'orchestrator',
        content: `I've created a **${plan.steps.length}-step plan** for your request.\n\n${mockStepLines}\n\n> No files will be modified until you approve.\n\n*Using mock plan — configure a model in Settings for AI-generated plans.*`,
        showPlanCard: true,
      });
      addLog(`Plan generated (mock): ${plan.steps.length} steps`, 'info');
      lastSubmittedPlannerGoalRef.current = userGoal;
      setIsThinking(false);
      return;
    }

    const memory = getOrIndexProject(files, projectName);
    addLog(`Project indexed: ${memory.repoMap.framework} / ${memory.repoMap.primaryLanguage}`, 'info');

    // Build structured project identity from memory — this gets injected as
    // explicit fields the LLM cannot miss (not buried in markdown).
    const flat = (() => {
      const r: typeof files = [];
      const walk = (nodes: typeof files) => { for (const n of nodes) { if (n.type === 'file') r.push(n); if (n.children) walk(n.children); } };
      walk(files);
      return r;
    })();
    const hasSourceFiles = flat.some(f => /\.(jsx?|tsx?|py|rs|go|rb|php|cs|java)$/.test(f.path));
    const hasPackageJson = flat.some(f => f.name === 'package.json');

    const projectIdentity = {
      framework: memory.repoMap.framework,
      packageManager: memory.repoMap.packageManager,
      language: memory.repoMap.primaryLanguage,
      styling: memory.conventions.styling !== 'N/A' ? memory.conventions.styling : undefined,
      entryPoints: memory.repoMap.entryPoints,
      runCommands: memory.repoMap.runCommands,
      hasExistingProject: hasSourceFiles || hasPackageJson,
    };

    // Seed the first activity with real project info
    const fileCount = flat.length;
    pushOrUpdateActivity(
      `Indexed · ${fileCount} files · ${memory.repoMap.framework} / ${memory.repoMap.primaryLanguage}`,
    );

    planHadError.current = false;

    const msgs = useWorkbenchStore.getState().messages;
    const lastUserWithImages = [...msgs].reverse().find(m => m.role === 'user' && m.images && m.images.length > 0);

    const planResult = await orchestrator.startTask(
      {
        userGoal,
        files,
        projectName,
        skillMd: memory.skillMd,
        projectIdentity,
        orchestratorModel: model,
        projectPath: projectPath ?? undefined,
        userImages: lastUserWithImages?.images,
      },
      {
        onStatus: (s) => {
          pushOrUpdateActivity(s);
          // Sync live tok/s from the orchestrator's "Receiving · N tokens · X tok/s" line
          if (s.startsWith('Receiving ·')) {
            const tps = extractTokPerSec(s);
            if (tps) setLiveTokPerSec(Number(tps));
          }
        },
        onLog: (msg, type) => addLog(msg, type),
        onTokens: applyTokenUsage,
        onPlanReady: async (p) => {
          const wasFallbackPlan = planHadError.current;
          setCurrentPlan(p);

          // Build step summary for inline display
          const stepLines = p.steps.map((s, i) => {
            const icon = s.action === 'run_command' ? '`$`' : s.action === 'create_file' ? '`+`' : s.action === 'delete_file' ? '`-`' : '`~`';
            const target = s.command ? `\`${s.command}\`` : s.path ? `\`${s.path}\`` : '';
            return `${i + 1}. ${icon} ${s.description}${target ? ' — ' + target : ''}`;
          }).join('\n');

          if (wasFallbackPlan) {
            addMessage({
              role: 'assistant',
              agent: 'orchestrator',
              content: `Couldn't reach the AI model — showing a template plan instead.\n\n${stepLines}\n\n> No files will be modified until you approve.`,
              showPlanCard: true,
            });
          } else {
            addMessage({
              role: 'assistant',
              agent: 'orchestrator',
              content:
                `Here is a **${p.steps.length}-step plan**. Review it in the card below.\n\n${stepLines}\n\n` +
                '> **Nothing runs until you approve** — use **Execute** to run the plan, **Modify** to describe what to change and get a revised plan, or **Reject** to cancel.',
              showPlanCard: true,
            });
          }
          addLog(`Plan ready: ${p.steps.length} steps (awaiting approval)`, 'success');
          planHadError.current = false;
          lastSubmittedPlannerGoalRef.current = userGoal;

          if (!wasFallbackPlan) {
            useWorkbenchStore.getState().updatePlanStatus('pending');
          }
        },
        onError: (err) => {
          planHadError.current = true;
          addLog(`Plan generation failed: ${err}`, 'error');
        },
      },
    );

    if (planResult === null) {
      addMessage({
        role: 'assistant',
        agent: 'orchestrator',
        content: '**Stopped** — planning was cancelled before a plan finished.',
      });
    }

    // Mark all activities done
    setPlanActivities(prev => prev.map(a => ({ ...a, done: true })));
    setIsThinking(false);
  };

  const handlePlanGeneration = async (userMsg: string) => {
    await runPlanningWithUserGoalRef.current(userMsg);
  };

  /**
   * Run the Orchestrator/Coder multi-round agent tool loop.
   * Called when chat mode is active AND both an orchestrator model and a coder
   * model are configured. Replaces the single-shot `handleChatResponse` path so
   * that the Coder's result is fed back into the Orchestrator's conversation and
   * rounds continue until `finish_task` is called.
   */
  const handleAgentToolLoop = async (userMsg: string) => {
    const ms = useModelStore.getState();
    const orchestratorModel = ms.getModelForRole('orchestrator');
    const coderModel = ms.getModelForRole('coder');
    if (!orchestratorModel?.enabled) {
      await handleChatResponse(userMsg, 'orchestrator');
      return;
    }

    const state = useWorkbenchStore.getState();
    const projectPath = state.projectPath;
    if (!projectPath) {
      // No project open — fall back to single-shot chat
      await handleChatResponse(userMsg, 'orchestrator');
      return;
    }

    // Build system prompt
    const withCoder = !!(coderModel?.enabled);
    const systemPrompt = getAgentSystemPrompt({ withCoder });

    // Build context blocks (same as handleChatResponse)
    const contextWindow = contextLimitForModel(orchestratorModel);
    const projectMemory = useProjectMemoryStore.getState().getMemory(state.projectName);
    const skillMd = projectMemory?.skillMd ?? '';
    const skeletonBudget = contextWindow <= 32_000
      ? Math.min(Math.floor(contextWindow * 0.20), 4000)
      : Math.min(Math.floor(contextWindow * 0.10), 6000);
    const skeletonText = state.files.length
      ? getBudgetedSkeletonText(state.files, state.projectName, skeletonBudget)
      : '';
    const memoryPrompt = useAgentMemoryStore.getState().buildMemoryPrompt(state.projectName);
    const envBlock = state.envInfo ? formatEnvForPrompt(state.envInfo) : '';
    let installHistoryBlock = '';
    if (isTauri() && projectPath) {
      try {
        const root = resolveEffectiveRoot(projectPath, state.files);
        installHistoryBlock = await buildInstallContext(root) ?? '';
      } catch { /* non-fatal */ }
    }
    const fullSystem = [
      systemPrompt,
      skillMd ? `\n## Project Info\n${skillMd}` : '',
      skeletonText ? `\n## Project Structure\n${skeletonText}` : '',
      envBlock ? `\n${envBlock}` : '',
      installHistoryBlock ? `\n## Install History\n${installHistoryBlock}` : '',
      memoryPrompt,
    ].filter(Boolean).join('\n\n');

    // Convert existing chat history to API messages (without system, which goes in opts)
    const recent = state.messages.slice(-80);
    const rawApiMessages = chatMessagesToApiMessages(recent);
    const fullSystemTokens = roughTokensFromText(fullSystem);
    const compressedMessages = compressMessages(rawApiMessages, {
      contextWindowTokens: contextWindow,
      systemPromptTokens: fullSystemTokens,
      skeletonTokens: 0,
    });

    // The last message is the user's current message — use the rest as history
    // (the user message was already added to the store before handleSend calls us)
    const initialMessages: ModelRequestMessage[] = compressedMessages;

    const streamAbort = beginChatStream();

    await runAgentToolLoop({
      model: orchestratorModel,
      coderModel: withCoder ? coderModel! : undefined,
      systemPrompt: fullSystem,
      initialMessages,
      projectPath,
      signal: streamAbort,
      callbacks: {
        onChunk: (chunk) => {
          trackStreamChunk(chunk);
          setStreamingContent(prev => prev + chunk);
        },
        onRoundComplete: (content, invocations, agent = 'orchestrator') => {
          setStreamingContent('');
          if (content || invocations.length > 0) {
            addMessage({ role: 'assistant', agent, content, toolInvocations: invocations.length > 0 ? invocations : undefined });
          }
          applyTokenUsage({
            inputTokens: roughTokensFromRequestMessages(initialMessages),
            outputTokens: Math.max(1, roughTokensFromText(content)),
          });
        },
        onFinished: (summary) => {
          setStreamingContent('');
          setIsThinking(false);
          if (summary) {
            addMessage({ role: 'assistant', agent: 'orchestrator', content: summary });
          }
          addLog('Agent task completed', 'success');
        },
        onLog: (msg, type) => addLog(msg, type),
        onTerminal: (line) => addLog(`[terminal] ${line}`, 'info'),
        onTokens: (usage) => applyTokenUsage(usage),
        onStatus: (status) => {
          // Surface orchestrator/coder status in the streaming area
          setStreamingContent(prev => {
            // Only show status updates that arrive before content starts flowing
            // Once real content is streaming, don't overwrite with status noise
            if (prev) return prev;
            return '';
          });
          void status; // status is shown in logs
          addLog(status, 'info');
        },
        onTimeline: (line) => addLog(`[agent] ${line}`, 'info'),
        onNoToolWarning: (_attempt, _limit, agent) => {
          addLog(`${agent} model is not calling tools — may need a stronger model`, 'warning');
        },
      },
    });

    setIsThinking(false);
    setStreamingContent('');
  };

  const handlePlanRevision = useCallback(async (feedback: string) => {
    const trimmed = feedback.trim();
    if (!trimmed) {
      useWorkbenchStore.getState().addLog('Describe what to change before regenerating the plan.', 'warning');
      return;
    }
    if (isThinkingRef.current) {
      useWorkbenchStore.getState().addLog('Planner is busy — wait for it to finish.', 'warning');
      return;
    }
    const ws = useWorkbenchStore.getState();
    const p = ws.currentPlan;
    if (!p || p.status !== 'pending') return;
    const base = lastSubmittedPlannerGoalRef.current.trim();
    if (!base) {
      ws.addLog('Nothing to revise yet — wait for a plan or send a new request from chat.', 'warning');
      return;
    }
    const stepSummary = p.steps
      .map((s, i) => {
        const tail = [s.path && `path: ${s.path}`, s.command && `cmd: ${s.command}`].filter(Boolean).join(' · ');
        return `${i + 1}. [${s.action}] ${s.description}${tail ? ` (${tail})` : ''}`;
      })
      .join('\n');
    const revisedGoal =
      `${base}\n\n---\n` +
      `The user has not executed this plan yet; treat the repo as unchanged.\n\n` +
      `Previous plan summary: ${p.summary}\nPrevious steps:\n${stepSummary}\n\n` +
      `User feedback — produce a **revised** plan that incorporates this:\n${trimmed}\n\n` +
      `Reply with a full replacement plan (do not assume prior steps ran).`;

    ws.addMessage({ role: 'user', content: `**Plan revision:**\n${trimmed}` });
    ws.addLog('Regenerating plan from your feedback…', 'info');
    setPlanActivities([]);
    setIsThinking(true);
    requestStartTime.current = Date.now();
    await runPlanningWithUserGoalRef.current(revisedGoal);
    saveCurrentChat(useWorkbenchStore.getState().messages);
  }, [setIsThinking, saveCurrentChat]);

  useEffect(() => {
    registerPlanRevisionHandler(handlePlanRevision);
    return () => registerPlanRevisionHandler(null);
  }, [handlePlanRevision]);

  const resolveChatModel = useCallback((chatRole: 'orchestrator' | 'coder') => {
    const ms = useModelStore.getState();
    // getSelectedChatModel() already returns the full ModelConfig object (or undefined)
    const manual = ms.getSelectedChatModel();
    return manual ?? ms.getModelForRole(chatRole) ?? ms.getModelForRole('orchestrator');
  }, []);

  const handleMockChat = async (asAgent: 'orchestrator' | 'coder' = 'orchestrator') => {
    await new Promise(r => setTimeout(r, 1500));
    const content =
      asAgent === 'coder'
        ? `Here's a quick take:\n\n1. Inspect the failing file and stack trace\n2. Apply a minimal fix and re-run tests\n3. Use **Rollback** in the plan panel if something went wrong\n\n*⚠️ Using mock response — enable a **Coder** role model in Settings for real answers while building.*`
        : `Great question! Here's what I'd suggest:\n\n1. Create the component structure\n2. Add proper TypeScript types\n3. Connect to your existing routing\n\nSwitch to **Plan mode** to have me generate an executable plan with file changes and diffs.\n\n*⚠️ Using mock response — configure a model in Settings for real AI responses.*`;
    addMessage({ role: 'assistant', agent: asAgent, content });
    setIsThinking(false);
  };

  const tryContinueToolChain = useCallback(
    async (messageId: string) => {
      const state = useWorkbenchStore.getState();
      const m = state.messages.find(x => x.id === messageId);
      if (!m?.toolInvocations?.length) return;
      const allDone = m.toolInvocations.every(t =>
        ['completed', 'failed', 'rejected'].includes(t.status),
      );
      if (!allDone) return;

      const chatRole: 'orchestrator' | 'coder' = m.agent === 'coder' ? 'coder' : 'orchestrator';
      const model = resolveChatModel(chatRole);
      if (!model?.enabled) return;

      toolRoundDepthRef.current += 1;
      if (toolRoundDepthRef.current > MAX_TOOL_ROUNDS) {
        state.addLog('Max assistant tool rounds reached.', 'warning');
        return;
      }

      setIsThinking(true);
      setStreamingContent('');
      requestStartTime.current = Date.now();
      pendingStreamUsage.current = null;

      const shellAvailable = isTauri() && !!state.projectPath;
      const toolsEnabled = shellAvailable && providerSupportsNativeTools(model.provider);
      const systemPrompt = getChatSystemPrompt(chatRole, isTauri(), { toolsEnabled });

      // Build context-aware system prompt with skillMd + skeleton + memory + env + installs
      const contextWindow = contextLimitForModel(model);
      const projectMemory2 = useProjectMemoryStore.getState().getMemory(state.projectName);
      const skillMd2 = projectMemory2?.skillMd ?? '';
      // Reserve up to 20% of the context window for structure, capped at 6k tokens.
      // For small windows (≤32k) use a higher ratio so the model gets enough context.
      const skeletonBudget = contextWindow <= 32_000
        ? Math.min(Math.floor(contextWindow * 0.20), 4000)
        : Math.min(Math.floor(contextWindow * 0.10), 6000);
      const skeletonText = state.files.length
        ? getBudgetedSkeletonText(state.files, state.projectName, skeletonBudget)
        : '';
      const memoryPrompt = useAgentMemoryStore.getState().buildMemoryPrompt(state.projectName);
      // Environment info — probed on project open, always available
      const envInfo2 = state.envInfo;
      const envBlock = envInfo2 ? formatEnvForPrompt(envInfo2) : '';
      // Install history — tells agents what worked and failed in past sessions
      let installHistoryBlock = '';
      if (isTauri() && state.projectPath) {
        try {
          const root2 = resolveEffectiveRoot(state.projectPath, state.files);
          installHistoryBlock = await buildInstallContext(root2) ?? '';
        } catch { /* non-fatal */ }
      }
      const fullSystem = [
        systemPrompt,
        skillMd2 ? `\n## Project Info\n${skillMd2}` : '',
        skeletonText ? `\n## Project Structure\n${skeletonText}` : '',
        envBlock ? `\n${envBlock}` : '',
        installHistoryBlock ? `\n## Install History\n${installHistoryBlock}` : '',
        memoryPrompt,
      ].filter(Boolean).join('\n\n');
      const fullSystemTokens = roughTokensFromText(fullSystem);

      // Keep a longer recent transcript so the model sees more chat turns.
      const recent = state.messages.slice(-80);
      const rawApiMessages = chatMessagesToApiMessages(recent);
      const compressedMessages = compressMessages(rawApiMessages, {
        contextWindowTokens: contextWindow,
        systemPromptTokens: fullSystemTokens,
        skeletonTokens: 0, // already included in fullSystemTokens
      });
      const apiMessages: ModelRequestMessage[] = [
        { role: 'system', content: fullSystem },
        ...compressedMessages,
      ];

      const streamSignal = beginChatStream();

      const onTokensFromStream = (usage: TokenUsage) => {
        if (usage.inputTokens > 0 || usage.outputTokens > 0) {
          pendingStreamUsage.current = usage;
          applyTokenUsage(usage);
        }
      };

      const onDone = (fullText: string, meta?: CallModelDoneMeta) => {
        setStreamingContent('');
        setIsThinking(false);
        const usage = pendingStreamUsage.current ?? meta?.usage;
        if (usage && ((usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0)) {
          applyTokenUsage(usage);
        } else {
          applyTokenUsage({
            inputTokens: roughTokensFromRequestMessages(apiMessages),
            outputTokens: Math.max(1, roughTokensFromText(fullText)),
          });
        }
        const tcalls = meta?.toolCalls;
        if (tcalls?.length && toolsEnabled) {
          const { invocations, needsUserApproval } = invocationsFromToolCalls(tcalls, shellAvailable, true);
          addMessage({ role: 'assistant', agent: chatRole, content: fullText, toolInvocations: invocations });
          addLog(`Response from ${model.name} (tools)`, 'success');
          const toolNames = invocations.map(t => t.name);
          const mems = extractMemoriesFromResponse(state.projectName, '', fullText, toolNames);
          for (const m of mems) useAgentMemoryStore.getState().addMemory(m);
          if (!needsUserApproval) {
            const lastId = useWorkbenchStore.getState().messages.at(-1)?.id;
            if (lastId) queueMicrotask(() => tryContinueToolChainRef.current(lastId));
          }
          return;
        }
        // Fallback: some models output tool calls as text "[tool_calls]\nfn({...})"
        // instead of structured API tool_calls. Parse and render them as cards.
        if (toolsEnabled) {
          const textParsed = parseTextToolCalls(fullText);
          if (textParsed) {
            const { invocations, needsUserApproval } = invocationsFromToolCalls(
              textParsed.toolCalls as Parameters<typeof invocationsFromToolCalls>[0],
              shellAvailable,
              true,
            );
            addMessage({ role: 'assistant', agent: chatRole, content: textParsed.cleanText, toolInvocations: invocations });
            addLog(`Response from ${model.name} (text tools)`, 'success');
            const toolNames = invocations.map(t => t.name);
            const mems = extractMemoriesFromResponse(state.projectName, '', fullText, toolNames);
            for (const m of mems) useAgentMemoryStore.getState().addMemory(m);
            if (!needsUserApproval) {
              const lastId = useWorkbenchStore.getState().messages.at(-1)?.id;
              if (lastId) queueMicrotask(() => tryContinueToolChainRef.current(lastId));
            }
            return;
          }
        }
        addMessage({ role: 'assistant', agent: chatRole, content: fullText });
        addLog(`Response received from ${model.name}`, 'success');
      };

      callModel(
        modelToRequest(
          model,
          apiMessages,
          toolsEnabled ? { tools: ALL_CHAT_TOOLS, signal: streamSignal } : { signal: streamSignal },
        ),
        (chunk) => {
          trackStreamChunk(chunk);
          setStreamingContent(prev => prev + chunk);
        },
        onDone,
        (error) => {
          setStreamingContent('');
          setIsThinking(false);
          if (error.name === 'AbortError') {
            addMessage({ role: 'assistant', agent: chatRole, content: '**Stopped** — reply cancelled.' });
            return;
          }
          setStreamError(error.message);
          addLog(`Model error: ${error.message}`, 'error');
          void handleMockChat(chatRole);
        },
        onTokensFromStream,
      );
    },
    [addLog, addMessage, applyTokenUsage, resolveChatModel],
  );

  tryContinueToolChainRef.current = tryContinueToolChain;

  const handleChatResponse = async (
    _userMsg: string,
    chatRole: 'orchestrator' | 'coder',
  ) => {
    const model = getActiveModel(chatRole);

    if (!model || !model.enabled) {
      await handleMockChat(chatRole);
      return;
    }

    toolRoundDepthRef.current = 0;
    requestStartTime.current = Date.now();
    pendingStreamUsage.current = null;

    const state = useWorkbenchStore.getState();
    const shellAvailable = isTauri() && !!state.projectPath;
    const toolsEnabled = shellAvailable && providerSupportsNativeTools(model.provider);
    const systemPrompt = getChatSystemPrompt(chatRole, isTauri(), { toolsEnabled });

    // Build context-aware system prompt with skillMd + skeleton + memory + env + installs
    const contextWindow = contextLimitForModel(model);
    const projectMemory = useProjectMemoryStore.getState().getMemory(state.projectName);
    const skillMd = projectMemory?.skillMd ?? '';
    const skeletonBudget = contextWindow <= 32_000
      ? Math.min(Math.floor(contextWindow * 0.20), 4000)
      : Math.min(Math.floor(contextWindow * 0.10), 6000);
    const skeletonText = state.files.length
      ? getBudgetedSkeletonText(state.files, state.projectName, skeletonBudget)
      : '';
    const memoryPrompt = useAgentMemoryStore.getState().buildMemoryPrompt(state.projectName);
    const envBlock2 = state.envInfo ? formatEnvForPrompt(state.envInfo) : '';
    let installHistoryBlock2 = '';
    if (isTauri() && state.projectPath) {
      try {
        const root3 = resolveEffectiveRoot(state.projectPath, state.files);
        installHistoryBlock2 = await buildInstallContext(root3) ?? '';
      } catch { /* non-fatal */ }
    }
    const fullSystem = [
      systemPrompt,
      skillMd ? `\n## Project Info\n${skillMd}` : '',
      skeletonText ? `\n## Project Structure\n${skeletonText}` : '',
      envBlock2 ? `\n${envBlock2}` : '',
      installHistoryBlock2 ? `\n## Install History\n${installHistoryBlock2}` : '',
      memoryPrompt,
    ].filter(Boolean).join('\n\n');
    const fullSystemTokens = roughTokensFromText(fullSystem);

    // Keep a longer recent transcript for direct chat responses as well.
    const recent = state.messages.slice(-80);
    const rawApiMessages = chatMessagesToApiMessages(recent);
    const compressedMessages = compressMessages(rawApiMessages, {
      contextWindowTokens: contextWindow,
      systemPromptTokens: fullSystemTokens,
      skeletonTokens: 0,
    });
    const apiMessages: ModelRequestMessage[] = [
      { role: 'system', content: fullSystem },
      ...compressedMessages,
    ];

    setStreamingContent('');
    const streamSignal = beginChatStream();

    // Emit real usage immediately when it arrives from the stream (Ollama / OpenAI).
    const onTokensFromStream = (usage: TokenUsage) => {
      if (usage.inputTokens > 0 || usage.outputTokens > 0) {
        pendingStreamUsage.current = usage;
        applyTokenUsage(usage);
      }
    };

    const onDone = (fullText: string, meta?: CallModelDoneMeta) => {
      setStreamingContent('');
      setIsThinking(false);
      // If the provider never sent usage, fall back to a character-length estimate.
      const usage = pendingStreamUsage.current ?? meta?.usage;
      if (usage && ((usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0)) {
        applyTokenUsage(usage);
      } else {
        applyTokenUsage({
          inputTokens: roughTokensFromRequestMessages(apiMessages),
          outputTokens: Math.max(1, roughTokensFromText(fullText)),
        });
      }
      const tcalls = meta?.toolCalls;
      if (tcalls?.length && toolsEnabled) {
        const { invocations, needsUserApproval } = invocationsFromToolCalls(tcalls, shellAvailable, true);
        addMessage({ role: 'assistant', agent: chatRole, content: fullText, toolInvocations: invocations });
        addLog(`Response from ${model.name} (tools)`, 'success');
        const toolNames = invocations.map(t => t.name);
        const mems = extractMemoriesFromResponse(state.projectName, _userMsg, fullText, toolNames);
        for (const m of mems) useAgentMemoryStore.getState().addMemory(m);
        if (!needsUserApproval) {
          const lastId = useWorkbenchStore.getState().messages.at(-1)?.id;
          if (lastId) queueMicrotask(() => tryContinueToolChainRef.current(lastId));
        }
        return;
      }
      // Fallback: some models output tool calls as text "[tool_calls]\nfn({...})"
      if (toolsEnabled) {
        const textParsed = parseTextToolCalls(fullText);
        if (textParsed) {
          const { invocations, needsUserApproval } = invocationsFromToolCalls(
            textParsed.toolCalls as Parameters<typeof invocationsFromToolCalls>[0],
            shellAvailable,
            true,
          );
          addMessage({ role: 'assistant', agent: chatRole, content: textParsed.cleanText, toolInvocations: invocations });
          addLog(`Response from ${model.name} (text tools)`, 'success');
          const toolNames = invocations.map(t => t.name);
          const mems = extractMemoriesFromResponse(state.projectName, _userMsg, fullText, toolNames);
          for (const m of mems) useAgentMemoryStore.getState().addMemory(m);
          if (!needsUserApproval) {
            const lastId = useWorkbenchStore.getState().messages.at(-1)?.id;
            if (lastId) queueMicrotask(() => tryContinueToolChainRef.current(lastId));
          }
          return;
        }
      }
      addMessage({ role: 'assistant', agent: chatRole, content: fullText });
      addLog(`Response received from ${model.name}`, 'success');
    };

    callModel(
      modelToRequest(
        model,
        apiMessages,
        toolsEnabled ? { tools: ALL_CHAT_TOOLS, signal: streamSignal } : { signal: streamSignal },
      ),
      (chunk) => {
        trackStreamChunk(chunk);
        setStreamingContent(prev => prev + chunk);
      },
      onDone,
      (error) => {
        setStreamingContent('');
        setIsThinking(false);
        if (error.name === 'AbortError') {
          addMessage({ role: 'assistant', agent: chatRole, content: '**Stopped** — reply cancelled.' });
          return;
        }
        setStreamError(error.message);
        addLog(`Model error: ${error.message}`, 'error');
        void handleMockChat(chatRole);
      },
      onTokensFromStream,
    );
  };

  const hasComposableInput = Boolean(input.trim() || pendingImages.length > 0 || pendingTextFiles.length > 0);
  const canSendIdle = hasComposableInput && !isAgentBusy;

  // Only show the ChatPlanCard on the *last* message that has showPlanCard, to
  // prevent every prior plan message from re-rendering the same current plan.
  const lastPlanCardMsgId = [...messages].reverse().find(m => m.showPlanCard)?.id;

  return (
    <div className="h-full min-h-0 flex flex-col bg-surface-panel px-3.5 sm:px-4">
      {/* Plan tab link removed — plan is now shown inline in chat via ChatPlanCard */}

      <div ref={messagesScrollRef} className="flex-1 overflow-y-auto py-3 space-y-3 min-h-0">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={msg.role === 'user' ? 'flex justify-end w-full min-w-0' : 'w-full min-w-0'}
          >
            {msg.role === 'user' ? (
              <div className="max-w-full w-fit min-w-0 bg-secondary border-2 border-primary/55 rounded-lg px-3.5 py-2.5 text-[12px] text-foreground space-y-2">
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {msg.images.map((img, i) => (
                      <img
                        key={i}
                        src={`data:${img.mediaType};base64,${img.dataBase64}`}
                        alt=""
                        className="max-h-28 rounded border border-primary/40 object-cover"
                      />
                    ))}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            ) : (
              <div className="w-full min-w-0">
                {msg.agent && (
                  <AgentLabel agent={msg.agent} />
                )}
                <div className="rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed bg-card text-card-foreground border border-border/40">
                  <div className="prose prose-invert max-w-none text-[12px] leading-relaxed [&>p]:m-0 [&>p+p]:mt-2 [&>ul]:mt-1 [&>ol]:mt-1 [&>blockquote]:border-primary/50 [&>blockquote]:text-muted-foreground [&_code]:font-mono [&_code]:text-[11px]">
                    <ChatMarkdown content={msg.content} />
                  </div>
                  {msg.toolInvocations && msg.toolInvocations.length > 0 && (
                    <ChatToolInvocations
                      messageId={msg.id}
                      invocations={msg.toolInvocations}
                      onChainMaybeContinue={tryContinueToolChain}
                    />
                  )}
                  {msg.showPlanCard && msg.id === lastPlanCardMsgId && <ChatPlanCard />}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Streaming content with live progress bar */}
        {isThinking && streamingContent && (
          <div className="w-full min-w-0">
            <AgentLabel agent={(mode === 'agent' || mode === 'build') ? 'coder' : 'orchestrator'} thinking />
            {/* Live progress status line */}
            <div className="flex items-center gap-2 mb-1.5 px-1 min-w-0">
              {(mode === 'agent' || mode === 'build') ? (
                <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
              ) : (
                <Brain className="h-3 w-3 text-accent animate-pulse shrink-0" />
              )}
              <span className="text-[11px] text-primary font-medium truncate min-w-0">
                {detectStreamProgress(streamingContent)}
                {(liveTurnTokens.in > 0 || liveTurnTokens.out > 0) && (
                  <span className="text-muted-foreground font-normal">
                    {' '}
                    · {formatTokenCount(liveTurnTokens.in)} in / {formatTokenCount(liveTurnTokens.out)} out
                  </span>
                )}
                {liveTokPerSec !== null && (
                  <span className="text-muted-foreground font-normal">
                    {' '}· {liveTokPerSec} tok/s
                  </span>
                )}
              </span>
              {thinkingElapsedMs > 600 && (
                <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {fmtElapsed(thinkingElapsedMs)}
                </span>
              )}
            </div>
            <div className="rounded-lg px-3.5 py-2.5 text-[12px] leading-relaxed bg-card text-card-foreground border border-border/40">
              <div className="prose prose-invert max-w-none text-[12px] leading-relaxed [&>p]:m-0 [&>p+p]:mt-2 [&>ul]:mt-1 [&>ol]:mt-1 [&_code]:font-mono [&_code]:text-[11px]">
                <ChatMarkdown content={streamingContent} />
              </div>
            </div>
          </div>
        )}

        {/* Orchestrator activity feed — shown while planning */}
        {isThinking && planActivities.length > 0 && (
          <PlanActivityFeed activities={planActivities} elapsedMs={thinkingElapsedMs} />
        )}

        {/* Generic thinking indicator — chat / build mode (before any content streams) */}
        {isThinking && !streamingContent && planActivities.length === 0 && (
          <div className="w-full min-w-0">
            <AgentLabel agent={(mode === 'agent' || mode === 'build') ? 'coder' : 'orchestrator'} thinking />
            <div className="flex items-center gap-2 bg-card rounded-lg px-3 py-1.5 text-[11px] text-muted-foreground border border-border/40 min-w-0">
              {(mode === 'agent' || mode === 'build') ? (
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
              ) : (
                <Brain className="h-3.5 w-3.5 text-accent animate-pulse shrink-0" />
              )}
              <span className="truncate min-w-0">
                {liveTurnTokens.in > 0 || liveTurnTokens.out > 0 ? (
                  <>
                    <span className="text-foreground/90 font-mono tabular-nums">
                      {formatTokenCount(liveTurnTokens.in)} tok in
                    </span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-foreground/90 font-mono tabular-nums">
                      {formatTokenCount(liveTurnTokens.out)} tok out
                    </span>
                    {liveTokPerSec !== null ? (
                      <span className="text-muted-foreground"> · {liveTokPerSec} tok/s</span>
                    ) : (
                      <span className="text-muted-foreground"> · waiting for stream…</span>
                    )}
                  </>
                ) : (
                  <>Connecting to model…</>
                )}
              </span>
              {thinkingElapsedMs > 600 && (
                <span className="font-mono text-[10px] text-primary/60 tabular-nums shrink-0 ml-auto">
                  {fmtElapsed(thinkingElapsedMs)}
                </span>
              )}
            </div>
          </div>
        )}

        {streamError && (
          <div className="flex items-start gap-2 py-3 px-2 rounded-md bg-destructive/10 border border-destructive/25">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{streamError}</p>
          </div>
        )}

      </div>

      <div className="pt-2 pb-3 border-t border-border space-y-2 shrink-0">
        {/* ── Toolbar row: mode toggle · model · stop · context bar ── */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center bg-secondary rounded-lg p-1 shrink-0">
            {modeOptions.map(m => (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  mode === m.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <ModelDropdown />

          {/* Stop button — shown only while agent is busy */}
          {isAgentBusy && (
            <button
              type="button"
              onClick={handleStop}
              title="Stop generation / plan"
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25 transition-colors text-[11px] font-medium shrink-0"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          )}

          {/* Live tok/s — shown whenever the model is streaming (any mode) */}
          {isThinking && liveTokPerSec !== null && (
            <span className="font-mono text-[11px] text-primary/80 tabular-nums shrink-0">
              {liveTokPerSec} tok/s
            </span>
          )}

          {/* Thinking progress — only while thinking */}
          {isThinking && streamingContent && (
            <span className="text-[10px] text-primary/70 truncate min-w-0 hidden sm:block">
              {detectStreamProgress(streamingContent)}
            </span>
          )}

          <div className="flex-1" />

          {/* Context bar — right-aligned */}
          <ContextBar
            used={estimatedContext}
            limit={contextLimit}
            onNewChat={() => {
              if (isAgentBusy) handleStop();
              bumpChatSession();
            }}
          />
        </div>

        {/* Hidden file inputs */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePickFiles} />
        <input
          ref={textFileInputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.tsv,.xml,.yaml,.yml,.toml,.js,.jsx,.ts,.tsx,.css,.scss,.html,.py,.rs,.go,.java,.c,.cpp,.h,.sh,.sql,.log,.diff,.env,.dockerfile,.makefile,.graphql,.prisma,.proto"
          multiple
          className="hidden"
          onChange={handlePickFiles}
        />

        {/* Pending attachments preview */}
        {(pendingImages.length > 0 || pendingTextFiles.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {pendingImages.map(p => (
              <div key={p.id} className="relative group">
                <img src={p.previewUrl} alt="" className="h-14 w-14 object-cover rounded border border-border" />
                <button
                  type="button"
                  onClick={() => removePendingImage(p.id)}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {pendingTextFiles.map(p => (
              <div key={p.id} className="relative group flex items-center gap-1.5 h-14 px-3 rounded border border-border bg-secondary/60">
                <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-foreground truncate max-w-[120px]">{p.fileName}</p>
                  <p className="text-[10px] text-muted-foreground">{(p.textContent.length / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => removePendingTextFile(p.id)}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Input box with floating action buttons inside ── */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              if (canSendIdle) void handleSend();
            }}
            placeholder={(mode === 'agent' || mode === 'build' || mode === 'plan') ? 'Tell me what to do...' : 'Ask a question...'}
            className="w-full min-h-[6rem] max-h-44 bg-input text-foreground text-[12px] rounded-lg pl-3 pr-10 pt-3 pb-9 resize-none focus:outline-none focus:ring-2 focus:ring-primary/80 focus:ring-offset-2 focus:ring-offset-background placeholder:text-muted-foreground font-sans border border-border/60 overflow-y-auto"
            rows={4}
          />

          {/* Floating buttons — bottom-left inside textarea */}
          <div className="absolute bottom-2 left-2 flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => textFileInputRef.current?.click()}
              disabled={isThinking || (pendingImages.length + pendingTextFiles.length) >= MAX_ATTACHMENTS}
              title="Attach files (code, text, config…)"
              className="p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-secondary/80 disabled:opacity-30 transition-colors"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            {showImageAttach && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isThinking || (pendingImages.length + pendingTextFiles.length) >= MAX_ATTACHMENTS}
                title="Attach image"
                className="p-1.5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-secondary/80 disabled:opacity-30 transition-colors"
              >
                <ImagePlus className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => void toggleVoice()}
                disabled={isThinking || isTranscribing}
                title={isListening ? 'Stop — click to transcribe' : isTranscribing ? 'Transcribing…' : 'Voice input (click to record, click again to transcribe)'}
                className={`p-1.5 rounded-md transition-colors disabled:opacity-40 ${
                  isListening
                    ? 'text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 animate-pulse'
                    : isTranscribing
                    ? 'text-amber-400 bg-amber-500/10'
                    : 'text-muted-foreground/60 hover:text-foreground hover:bg-secondary/80'
                }`}
              >
                {isTranscribing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : isListening
                  ? <MicOff className="h-3.5 w-3.5" />
                  : <Mic className="h-3.5 w-3.5" />}
              </button>
              {voiceError && (
                <div className="absolute bottom-full right-0 mb-1 bg-destructive/90 text-destructive-foreground text-[10px] rounded px-2 py-1 whitespace-nowrap max-w-[220px] text-wrap z-50">
                  {voiceError}
                </div>
              )}
            </div>
          </div>

          {/* Send button — bottom-right inside textarea */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSendIdle}
            title="Send (Enter)"
            className="absolute bottom-2 right-2 p-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-35 transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Escalation dialog — surfaces when the repair loop is stuck and needs human input */}
      <EscalationDialog />
    </div>
  );
};

export default AIPanel;
