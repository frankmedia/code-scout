/**
 * AgentActivityFeed — structured activity feed for the agent tool loop.
 *
 * Parses timeline strings into typed entries (role headers, round info,
 * tool results, verification, delegation, prose) and renders them with
 * distinct visual treatments so the log is scannable at a glance.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import {
  Eye, Pencil, Terminal, Globe, ArrowRightLeft,
  CheckCircle2, Brain, Code2, Trash2, FolderPlus,
  Zap, Database, BookOpen, Send, Loader2, AlertTriangle,
  CircuitBoard, XCircle, ChevronsDown, ClipboardCopy,
} from 'lucide-react';
import { formatActivityLogForExport, normalizeActivityLine } from '@/utils/activityLineNormalize';

// ─── Line classification ──────────────────────────────────────────────────────

type LineKind =
  | 'role-header'   // "Orchestrator · model · round N/M · waiting…"  /  "Coder · model · …"
  | 'round-info'    // "Round N · 2 tool call(s) [names] · …"  /  "Coder rN · …"
  | 'delegation'    // "Delegate to coder: …"
  | 'tool-result'   // "→ write_to_file · ok"  /  "→ $ npm run build · exit 0 · ok"
  | 'verify'        // "Verify · exit 0 · ok"  /  "Verifying: …"
  | 'finish'        // "FINISH_TASK" or summary JSON
  | 'no-tools'      // "… NO TOOLS …"
  | 'general';      // everything else

interface ParsedLine {
  kind: LineKind;
  raw: string;
  role?: 'orchestrator' | 'coder';
  isError?: boolean;
}

function classifyLine(text: string): ParsedLine {
  const t = normalizeActivityLine(text);
  const isCoder = /^coder\b/i.test(t) || /\bcoder\b/i.test(t);
  const isOrch = /^orchestrator\b/i.test(t);
  const role: 'orchestrator' | 'coder' | undefined = isOrch ? 'orchestrator' : isCoder ? 'coder' : undefined;

  if (/^(Orchestrator|Coder)\s+·\s+.+·\s+round\s+\d/i.test(t))
    return { kind: 'role-header', raw: t, role };
  if (/^(Orchestrator|Coder)\s+·\s+.+·\s+text-only/i.test(t))
    return { kind: 'role-header', raw: t, role };
  if (/^Round\s+\d/i.test(t) || /^Coder\s+r\d/i.test(t))
    return { kind: 'round-info', raw: t, role: /^Coder/i.test(t) ? 'coder' : 'orchestrator' };
  if (/^Delegate\s+to\s+coder/i.test(t))
    return { kind: 'delegation', raw: t, role: 'orchestrator' };
  if (/^→\s+/.test(t)) {
    const isErr = /\b(error|fail|stderr)\b/i.test(t) || /exit\s+[1-9]/.test(t);
    return { kind: 'tool-result', raw: t, isError: isErr };
  }
  if (/^Verif/i.test(t))
    return { kind: 'verify', raw: t, isError: /\b(fail|error)\b/i.test(t) || /exit\s+[1-9]/.test(t) };
  if (/^FINISH_TASK/i.test(t) || /^Done\s*\(exit/i.test(t))
    return { kind: 'finish', raw: t };
  if (/NO\s+TOOLS/i.test(t))
    return { kind: 'no-tools', raw: t, role };
  return { kind: 'general', raw: t, role };
}

type FocusFilter = 'all' | 'orch' | 'coder';

/** De-emphasize headers that do not match the focus role; keeps tool rows readable. */
function shouldDimParsed(line: ParsedLine, filter: FocusFilter): boolean {
  if (filter === 'all') return false;
  if (line.kind === 'role-header' || line.kind === 'round-info') {
    return filter === 'coder' ? line.role !== 'coder' : line.role !== 'orchestrator';
  }
  if (line.kind === 'no-tools' && line.role) {
    return filter === 'coder' ? line.role !== 'coder' : line.role !== 'orchestrator';
  }
  return false;
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

const ROLE_STYLES = {
  orchestrator: {
    Icon: Brain,
    badge: 'bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20',
    label: 'Orchestrator',
  },
  coder: {
    Icon: Code2,
    badge: 'bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/20',
    label: 'Coder',
  },
} as const;

function RoleTag({ role }: { role: 'orchestrator' | 'coder' }) {
  const s = ROLE_STYLES[role];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${s.badge}`}>
      <s.Icon className="h-2.5 w-2.5" />
      {s.label}
    </span>
  );
}

function ToolBadge({ name }: { name: string }) {
  return (
    <code className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono text-foreground/80">
      {name}
    </code>
  );
}

function extractToolNames(text: string): string[] {
  const m = text.match(/\[([^\]]+)\]/);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

function extractProseQuote(text: string): string | null {
  const m = text.match(/«(.+?)»/s);
  return m ? m[1] : null;
}

function stripRolePrefix(text: string): string {
  return text.replace(/^(Orchestrator|Coder)\s*·\s*/i, '');
}

// ─── Line renderer ────────────────────────────────────────────────────────────

function FeedLine({ line }: { line: ParsedLine }) {
  switch (line.kind) {
    case 'role-header': {
      const parts = stripRolePrefix(line.raw).split('·').map(s => s.trim());
      return (
        <div className="flex flex-wrap items-center gap-1.5 pt-2.5 pb-1 border-t border-border/20 first:border-t-0 first:pt-0">
          {line.role && <RoleTag role={line.role} />}
          {parts.map((p, i) => (
            <span key={i} className="text-[10px] text-muted-foreground font-mono">
              {p}
            </span>
          ))}
        </div>
      );
    }
    case 'round-info': {
      const tools = extractToolNames(line.raw);
      const prose = extractProseQuote(line.raw);
      const noTools = /NO\s+TOOLS/i.test(line.raw);
      return (
        <div className="flex flex-wrap items-center gap-1.5 py-0.5 pl-3">
          <CircuitBoard className="h-3 w-3 text-muted-foreground/60 shrink-0" />
          <span className="text-[10px] font-semibold text-foreground/80">
            {line.raw.match(/^(Round\s+\d+|Coder\s+r\d+)/i)?.[0]}
          </span>
          {noTools && (
            <span className="text-[9px] font-semibold text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-1 py-0.5 rounded">NO TOOLS</span>
          )}
          {tools.map(t => <ToolBadge key={t} name={t} />)}
          {prose && (
            <span className="text-[10px] text-muted-foreground italic truncate max-w-[240px]" title={prose}>
              {prose.length > 80 ? prose.slice(0, 80) + '…' : prose}
            </span>
          )}
        </div>
      );
    }
    case 'delegation': {
      const body = line.raw.replace(/^Delegate\s+to\s+coder:\s*/i, '');
      return (
        <div className="py-1 pl-3">
          <div className="flex items-start gap-1.5">
            <ArrowRightLeft className="h-3 w-3 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">Delegate to coder</span>
              <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-3">{body}</p>
            </div>
          </div>
        </div>
      );
    }
    case 'tool-result': {
      const isOk = /·\s*ok\s*$/i.test(line.raw);
      const display = line.raw.replace(/^→\s*/, '');
      return (
        <div className="flex items-center gap-1.5 py-0.5 pl-6">
          {line.isError
            ? <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0" />
            : isOk
              ? <CheckCircle2 className="h-2.5 w-2.5 text-green-500 dark:text-green-400 shrink-0" />
              : <Terminal className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
          }
          <span className={`text-[10px] font-mono truncate ${line.isError ? 'text-red-600 dark:text-red-400' : 'text-foreground/70'}`}>
            {display}
          </span>
        </div>
      );
    }
    case 'verify': {
      const isOk = /·\s*ok\s*$/i.test(line.raw) || /exit\s+0/.test(line.raw);
      return (
        <div className="flex items-center gap-1.5 py-0.5 pl-3">
          {isOk
            ? <CheckCircle2 className="h-3 w-3 text-green-500 dark:text-green-400 shrink-0" />
            : <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
          }
          <span className={`text-[10px] font-mono ${isOk ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
            {line.raw}
          </span>
        </div>
      );
    }
    case 'finish':
      return (
        <div className="flex items-center gap-1.5 py-1 pl-3 mt-1 border-t border-border/20">
          <Zap className="h-3 w-3 text-yellow-500 shrink-0" />
          <span className="text-[10px] font-semibold text-foreground/80">{line.raw}</span>
        </div>
      );
    case 'no-tools': {
      const prose = extractProseQuote(line.raw);
      return (
        <div className="flex flex-wrap items-center gap-1.5 py-0.5 pl-3">
          <AlertTriangle className="h-2.5 w-2.5 text-yellow-500 shrink-0" />
          <span className="text-[9px] font-semibold text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-1 py-0.5 rounded">NO TOOLS</span>
          {prose && (
            <span className="text-[10px] text-muted-foreground italic truncate max-w-[240px]" title={prose}>
              {prose.length > 60 ? prose.slice(0, 60) + '…' : prose}
            </span>
          )}
        </div>
      );
    }
    default: {
      const prose = extractProseQuote(line.raw);
      const icon = /coder/i.test(line.raw) ? Code2 : /search|web/i.test(line.raw) ? Globe
        : /read/i.test(line.raw) ? Eye : /writ|edit/i.test(line.raw) ? Pencil
        : /delet/i.test(line.raw) ? Trash2 : /mkdir/i.test(line.raw) ? FolderPlus
        : /memory|save/i.test(line.raw) ? Database : /index/i.test(line.raw) ? BookOpen
        : Send;
      const Icon = icon;
      return (
        <div className="flex items-start gap-1.5 py-0.5 pl-3">
          <Icon className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0 mt-0.5" />
          <span className="text-[10px] font-mono text-foreground/70 leading-snug line-clamp-3 whitespace-normal break-words" title={line.raw}>
            {prose ? (
              <>
                <span className="not-italic">{line.raw.replace(/«.*?»/s, '').trim()}</span>
                {' '}
                <span className="italic text-muted-foreground">{prose.length > 80 ? prose.slice(0, 80) + '…' : prose}</span>
              </>
            ) : line.raw}
          </span>
        </div>
      );
    }
  }
}

// ─── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ current, max, size = 32 }: { current: number; max: number; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(current / max, 1);
  const offset = circumference * (1 - progress);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="currentColor"
          className="text-border/30" strokeWidth={2}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="currentColor"
          className="text-primary transition-all duration-500 ease-out"
          strokeWidth={2}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[8px] font-bold text-primary tabular-nums">{current}</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const ACTIVITY_FEED_TAIL = 200;

interface AgentActivityFeedProps {
  history: string[];
  currentStatus: string;
  isStreaming: boolean;
  roundInfo?: { current: number; max: number };
  className?: string;
}

export function AgentActivityFeed({
  history,
  currentStatus,
  isStreaming,
  roundInfo,
  className = '',
}: AgentActivityFeedProps) {
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('all');
  const [showJumpLatest, setShowJumpLatest] = useState(false);
  const feedScrollRef = useRef<HTMLDivElement>(null);
  const followBottomRef = useRef(true);

  const visible = useMemo(() => history.slice(-ACTIVITY_FEED_TAIL), [history]);
  const hiddenCount = history.length - visible.length;
  const parsed = useMemo(() => visible.map(classifyLine), [visible]);

  const rowVirtualizer = useVirtualizer({
    count: parsed.length,
    getScrollElement: () => feedScrollRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  const scrollFeedToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = feedScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    followBottomRef.current = true;
    setShowJumpLatest(false);
  }, []);

  const onFeedScroll = useCallback(() => {
    const el = feedScrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = gap < 56;
    followBottomRef.current = nearBottom;
    setShowJumpLatest(!nearBottom);
  }, []);

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [parsed, rowVirtualizer]);

  const virtualTotalHeight = rowVirtualizer.getTotalSize();

  useEffect(() => {
    if (!followBottomRef.current) return;
    const el = feedScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [visible, currentStatus, isStreaming, virtualTotalHeight]);

  const copyActivityLog = useCallback(async () => {
    const statusLine =
      isStreaming ? 'Streaming response…' : currentStatus?.trim() ? currentStatus.trim() : '';
    try {
      await navigator.clipboard.writeText(
        formatActivityLogForExport(history, {
          includeHeader: true,
          currentStatus: statusLine || undefined,
        }),
      );
      toast.success('Activity log copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }, [history, currentStatus, isStreaming]);

  const filterBtn =
    'px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors border border-transparent';
  const filterActive = 'bg-primary/15 text-primary border-primary/25';
  const filterIdle = 'text-muted-foreground/80 hover:bg-muted/40';

  return (
    <div className={`space-y-0 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/20">
        <div className="flex items-center gap-2 min-w-0">
          {roundInfo && <ProgressRing current={roundInfo.current} max={roundInfo.max} size={28} />}
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Activity</span>
            <span className="text-[8px] text-muted-foreground/70 font-normal normal-case tracking-normal">
              Orchestrator &amp; coder — scroll for earlier steps
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-0.5 flex-wrap justify-end" role="group" aria-label="Highlight activity by role">
            <button
              type="button"
              className={`${filterBtn} ${filterIdle}`}
              onClick={() => void copyActivityLog()}
              title="Copy full activity log (normalized) to clipboard"
            >
              <ClipboardCopy className="h-3 w-3 inline-block mr-0.5 align-middle opacity-80" />
              Copy
            </button>
            <button
              type="button"
              className={`${filterBtn} ${focusFilter === 'all' ? filterActive : filterIdle}`}
              onClick={() => setFocusFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`${filterBtn} ${focusFilter === 'orch' ? filterActive : filterIdle}`}
              onClick={() => setFocusFilter('orch')}
            >
              Orch
            </button>
            <button
              type="button"
              className={`${filterBtn} ${focusFilter === 'coder' ? filterActive : filterIdle}`}
              onClick={() => setFocusFilter('coder')}
            >
              Coder
            </button>
          </div>
          {hiddenCount > 0 && (
            <span className="text-[9px] text-muted-foreground/50 font-mono">+{hiddenCount} earlier</span>
          )}
        </div>
      </div>

      {/* Feed — scroll so orchestrator “waiting” spam does not push Coder rows out of view */}
      <div className="relative">
        <div
          ref={feedScrollRef}
          onScroll={onFeedScroll}
          className="max-h-[min(42vh,420px)] overflow-y-auto overscroll-contain"
        >
          <div className="px-2 py-1.5">
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const line = parsed[vi.index];
                const isLast = vi.index === parsed.length - 1;
                return (
                  <div
                    key={`${history.length - visible.length + vi.index}`}
                    data-index={vi.index}
                    ref={rowVirtualizer.measureElement}
                    className={`absolute left-0 top-0 w-full transition-opacity duration-150 ${
                      shouldDimParsed(line, focusFilter) ? 'opacity-35' : ''
                    } ${isLast ? 'animate-in fade-in slide-in-from-bottom-1 duration-300' : ''}`}
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <FeedLine line={line} />
                  </div>
                );
              })}
            </div>

            {currentStatus && (
              <div className="flex items-center gap-1.5 py-1 pl-3 animate-pulse">
                <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
                <span className="text-[10px] font-mono text-primary/80 truncate">
                  {isStreaming ? 'Streaming response…' : currentStatus}
                </span>
              </div>
            )}
          </div>
        </div>

        {showJumpLatest && (
          <button
            type="button"
            onClick={() => scrollFeedToBottom('smooth')}
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-border/60 bg-background/95 px-2 py-1 text-[9px] font-medium text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted/60 hover:text-foreground"
            title="Scroll to latest"
          >
            <ChevronsDown className="h-3 w-3" />
            Latest
          </button>
        )}
      </div>
    </div>
  );
}
