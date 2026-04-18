/**
 * TokenPowerGrid — GitHub-contribution-graph-style token visualiser.
 *
 * Each column = one assistant message in the session.
 * Cell brightness = relative token count (5 intensity levels, darkest to brightest green).
 * Scrolls left-to-right: oldest on left, newest on right.
 * Collapsible panel — defaults to collapsed (header-only).
 */

import React, { useMemo, useEffect, useState, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useWorkbenchStore } from '@/store/workbenchStore';

// ─── Green palette (applied on top of app bg) ──────────────────────────────
const LEVEL_CLASSES = [
  'bg-muted/30',         // 0 — empty
  'bg-emerald-900/40',   // 1 — faint
  'bg-emerald-700/60',   // 2 — low
  'bg-emerald-500/70',   // 3 — mid
  'bg-emerald-400',      // 4 — high (brightest)
] as const;

const ACCENT  = '#39d353';
const ROWS    = 7;

// ─── Formatters ──────────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}
function fmtRate(r: number | null): string {
  if (r === null) return '---';
  return r >= 1000 ? `${(r / 1000).toFixed(1)}k/s` : `${r}/s`;
}
function fmtElapsed(start: number | null): string {
  if (!start) return '---';
  const s = Math.floor((Date.now() - start) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(ss).padStart(2,'0')}s`;
  return `${ss}s`;
}

// ─── Inject keyframes once ───────────────────────────────────────────────────
const CSS_ID = 'tpg-v2-style';
const CSS = `
  @keyframes tpg-blink  { 0%,100%{opacity:1; box-shadow:0 0 7px 2px #39d35388} 50%{opacity:.5; box-shadow:0 0 2px 0 #39d35322} }
  @keyframes tpg-count  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
  .tpg-blink  { animation: tpg-blink  1.1s ease-in-out infinite }
  .tpg-count  { animation: tpg-count  0.25s ease-out both }
`;
function injectCss() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ─── Per-message token snapshot (sampled from workbench messages) ─────────────
interface MsgSample { tokens: number; role: 'orchestrator' | 'coder' | 'user' }

// ─── Component ───────────────────────────────────────────────────────────────
const TokenPowerGrid: React.FC = () => {
  useEffect(injectCss, []);

  const aiIsStreaming    = useWorkbenchStore(s => s.aiIsStreaming);
  const aiLiveTokPerSec = useWorkbenchStore(s => s.aiLiveTokPerSec);
  // Remember the last known speed so it doesn't disappear between streams
  const lastSpeedRef = useRef<number | null>(null);
  if (aiLiveTokPerSec !== null) lastSpeedRef.current = aiLiveTokPerSec;
  const aiSessionTotal  = useWorkbenchStore(s => s.aiSessionTotalTokens);
  const aiSessionStart  = useWorkbenchStore(s => s.aiSessionStartTime);
  const aiContextUsed   = useWorkbenchStore(s => s.aiContextUsed);
  const aiContextLimit  = useWorkbenchStore(s => s.aiContextLimit);
  const messages        = useWorkbenchStore(s => s.messages);

  const [collapsed, setCollapsed] = useState(true);

  // ── Tick every second for elapsed ────────────────────────────────────────
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1_000);
    return () => clearInterval(iv);
  }, []);

  // ── Animate the big number when it changes ────────────────────────────────
  const prevTotal = useRef(aiSessionTotal);
  const [countKey, setCountKey] = useState(0);
  useEffect(() => {
    if (aiSessionTotal !== prevTotal.current) {
      prevTotal.current = aiSessionTotal;
      setCountKey(k => k + 1);
    }
  }, [aiSessionTotal]);

  // ── Build per-message samples for the contribution grid ──────────────────
  const samples: MsgSample[] = useMemo(() => {
    return messages
      .filter(m => m.role === 'assistant')
      .map(m => ({
        tokens: (m as any).usage?.output_tokens ?? (m as any).usage?.total_tokens ?? 0,
        role: (m.agent ?? 'orchestrator') as MsgSample['role'],
      }));
  }, [messages]);

  // ── Determine grid dimensions from container width ────────────────────────
  const COLS = Math.max(15, samples.length + 2);

  // ── Normalise token counts to level 0-4 ───────────────────────────────────
  const maxTokens = useMemo(
    () => Math.max(1, ...samples.map(s => s.tokens)),
    [samples],
  );

  const grid = useMemo(() => {
    const cells: number[][] = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => 0),
    );

    samples.slice(-COLS).forEach((sample, colIdx) => {
      const ratio = sample.tokens / maxTokens;
      const filledRows = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * ROWS));
      const level = ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
      for (let r = ROWS - 1; r >= ROWS - filledRows; r--) {
        cells[r][colIdx] = level;
      }
    });

    if (aiIsStreaming && samples.length < COLS) {
      cells[ROWS - 1][samples.length] = 3;
    }

    return cells;
  }, [samples, maxTokens, COLS, aiIsStreaming]);

  const contextPct = aiContextLimit > 0
    ? Math.min(100, Math.round((aiContextUsed / aiContextLimit) * 100))
    : 0;

  const streamingCol = aiIsStreaming ? samples.length : -1;

  return (
    <div className="relative flex flex-col select-none overflow-hidden bg-card border-b border-border">

      {/* ── Header bar (always visible) ─────────────────────────────────── */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-2 px-3 py-2 shrink-0 w-full text-left hover:bg-secondary/40 transition-colors"
      >
        <span className="text-[10px] font-mono font-bold tracking-[0.15em] uppercase text-emerald-500">
          Token Activity
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {fmt(aiSessionTotal)} tokens
        </span>
        <div className="flex-1 h-px bg-border" />
        {aiIsStreaming ? (
          <div className="flex items-center gap-1">
            <span
              className="tpg-blink inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: ACCENT }}
            />
            <span className="text-[9px] font-mono font-semibold text-emerald-500">
              LIVE
            </span>
          </div>
        ) : (
          <span className="text-[9px] font-mono text-muted-foreground">
            {samples.length} turns
          </span>
        )}
        {collapsed
          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
        }
      </button>

      {/* ── Expanded content ─────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="flex flex-col gap-2.5 px-3 pb-3">

          {/* Big token counter */}
          <div className="flex flex-col items-center gap-0.5 py-1">
            <div
              key={countKey}
              className="tpg-count font-mono tabular-nums leading-none text-emerald-400"
              style={{
                fontSize: 'clamp(22px, 2.5vw, 32px)',
                letterSpacing: '-0.03em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmt(aiSessionTotal)}
            </div>
            <span className="text-[9px] font-mono tracking-[0.15em] uppercase text-muted-foreground">
              total tokens
            </span>
          </div>

          {/* Context window bar */}
          {aiContextLimit > 0 && (
            <div className="flex flex-col gap-1 px-0.5">
              <div className="flex justify-between items-baseline">
                <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                  Context window
                </span>
                <span
                  className="text-[10px] font-mono tabular-nums"
                  style={{
                    color: contextPct >= 90 ? 'hsl(var(--destructive))' : contextPct >= 75 ? 'hsl(var(--warning))' : undefined,
                  }}
                >
                  <span className={contextPct < 75 ? 'text-muted-foreground' : ''}>{contextPct}%</span>
                </span>
              </div>
              <div className="w-full rounded-full overflow-hidden h-[3px] bg-border">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    contextPct >= 90 ? 'bg-destructive' : contextPct >= 75 ? 'bg-warning' : 'bg-emerald-500/70'
                  }`}
                  style={{ width: `${contextPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-1 rounded-md px-2 py-1.5 bg-secondary/40 border border-border">
            {[
              {
                label: 'Context',
                value: aiContextLimit > 0
                  ? `${fmt(aiContextUsed)} / ${fmt(aiContextLimit)}`
                  : '---',
                highlight: false,
              },
              {
                label: 'Speed',
                value: aiLiveTokPerSec !== null
                  ? fmtRate(aiLiveTokPerSec)
                  : lastSpeedRef.current !== null
                    ? fmtRate(lastSpeedRef.current)
                    : '---',
                highlight: aiIsStreaming,
              },
              {
                label: 'Elapsed',
                value: fmtElapsed(aiSessionStart),
                highlight: false,
              },
            ].map(({ label, value, highlight }, i) => (
              <div
                key={label}
                className={`flex flex-col gap-0.5 ${i === 1 ? 'items-center' : i === 2 ? 'items-end' : ''}`}
              >
                <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground">
                  {label}
                </span>
                <span
                  className={`text-[10px] font-mono tabular-nums ${highlight ? 'text-emerald-400' : 'text-foreground/50'}`}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TokenPowerGrid;
