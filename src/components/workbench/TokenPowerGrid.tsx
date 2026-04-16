/**
 * TokenPowerGrid — GitHub-contribution-graph-style token visualiser.
 *
 * Each column = one assistant message in the session.
 * Cell brightness = relative token count (5 intensity levels, darkest → brightest green).
 * Scrolls left-to-right: oldest on left, newest on right.
 * Designed to be screenshot-shareable — the whole panel reads as a "heatmap card".
 */

import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useWorkbenchStore } from '@/store/workbenchStore';

// ─── GitHub-accurate green palette ──────────────────────────────────────────
const LEVELS = [
  '#0d1117', // 0 — empty
  '#0e4429', // 1 — faint
  '#006d32', // 2 — low
  '#26a641', // 3 — mid
  '#39d353', // 4 — high (brightest)
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
  if (r === null) return '—';
  return r >= 1000 ? `${(r / 1000).toFixed(1)}k/s` : `${r}/s`;
}
function fmtElapsed(start: number | null): string {
  if (!start) return '—';
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
  @keyframes tpg-glow   { 0%,100%{opacity:.18} 50%{opacity:.34} }
  @keyframes tpg-blink  { 0%,100%{opacity:1; box-shadow:0 0 7px 2px #39d35388} 50%{opacity:.5; box-shadow:0 0 2px 0 #39d35322} }
  @keyframes tpg-scanln { 0%{transform:translateY(-100%)} 100%{transform:translateY(400%)} }
  @keyframes tpg-count  { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
  .tpg-glow   { animation: tpg-glow   3.5s ease-in-out infinite }
  .tpg-blink  { animation: tpg-blink  1.1s ease-in-out infinite }
  .tpg-scanln { animation: tpg-scanln 4s linear infinite }
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
  const aiSessionTotal  = useWorkbenchStore(s => s.aiSessionTotalTokens);
  const aiSessionStart  = useWorkbenchStore(s => s.aiSessionStartTime);
  const aiContextUsed   = useWorkbenchStore(s => s.aiContextUsed);
  const aiContextLimit  = useWorkbenchStore(s => s.aiContextLimit);
  const messages        = useWorkbenchStore(s => s.messages);

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
  // We want ROWS=7 rows; derive cols from samples (min 15, fill to right edge)
  const COLS = Math.max(15, samples.length + 2); // +2 so there's always empty space on the right

  // ── Normalise token counts → level 0–4 ───────────────────────────────────
  const maxTokens = useMemo(
    () => Math.max(1, ...samples.map(s => s.tokens)),
    [samples],
  );

  // Build a 2D grid: ROWS rows × COLS cols.
  // Data fills bottom-to-top in each column (like GitHub), left-to-right for time.
  const grid = useMemo(() => {
    // cells[row][col]
    const cells: number[][] = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => 0),
    );

    // Fill columns from left. Each assistant message gets one column.
    // Distribute tokens across rows proportionally (taller column = more tokens).
    samples.slice(-COLS).forEach((sample, colIdx) => {
      const ratio = sample.tokens / maxTokens;
      const filledRows = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * ROWS));
      const level = ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
      // fill from bottom up
      for (let r = ROWS - 1; r >= ROWS - filledRows; r--) {
        cells[r][colIdx] = level;
      }
    });

    // Last column pulses when streaming
    if (aiIsStreaming && samples.length < COLS) {
      const streamCol = samples.length;
      // show a single mid-level blinking cell at the bottom
      cells[ROWS - 1][streamCol] = 3;
    }

    return cells;
  }, [samples, maxTokens, COLS, aiIsStreaming]);

  const contextPct = aiContextLimit > 0
    ? Math.min(100, Math.round((aiContextUsed / aiContextLimit) * 100))
    : 0;

  const streamingCol = aiIsStreaming ? samples.length : -1;

  return (
    <div
      className="relative flex flex-col h-full select-none overflow-hidden"
      style={{ background: '#010409', borderLeft: '1px solid rgba(57,211,83,0.10)' }}
    >
      {/* Ambient glow — breathes slowly */}
      <div
        className="tpg-glow pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 110%, rgba(57,211,83,0.14) 0%, transparent 70%)',
          zIndex: 0,
        }}
      />

      {/* Scan line — subtle moving highlight */}
      {aiIsStreaming && (
        <div
          className="tpg-scanln pointer-events-none absolute left-0 right-0"
          style={{
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(57,211,83,0.35) 50%, transparent 100%)',
            zIndex: 1,
            top: 0,
          }}
        />
      )}

      <div className="relative z-10 flex flex-col h-full p-3 gap-2.5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[10px] font-mono font-bold tracking-[0.2em] uppercase"
            style={{ color: ACCENT }}
          >
            Token Activity
          </span>
          <div className="flex-1 h-px" style={{ background: 'rgba(57,211,83,0.12)' }} />
          {/* Live badge */}
          {aiIsStreaming ? (
            <div className="flex items-center gap-1">
              <span
                className="tpg-blink inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: ACCENT }}
              />
              <span className="text-[9px] font-mono font-semibold" style={{ color: ACCENT }}>
                LIVE
              </span>
            </div>
          ) : (
            <span
              className="text-[9px] font-mono"
              style={{ color: 'rgba(57,211,83,0.3)' }}
            >
              {samples.length} turns
            </span>
          )}
        </div>

        {/* ── Big token counter ───────────────────────────────────────────── */}
        <div className="shrink-0 flex flex-col items-center gap-0.5 py-1">
          <div
            key={countKey}
            className="tpg-count font-mono tabular-nums leading-none"
            style={{
              fontSize: 'clamp(28px, 3.5vw, 42px)',
              color: ACCENT,
              textShadow: `0 0 24px ${ACCENT}55, 0 0 48px ${ACCENT}22`,
              letterSpacing: '-0.03em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmt(aiSessionTotal)}
          </div>
          <span
            className="text-[9px] font-mono tracking-[0.15em] uppercase"
            style={{ color: 'rgba(57,211,83,0.35)' }}
          >
            tokens · this session
          </span>
        </div>

        {/* ── Contribution grid ───────────────────────────────────────────── */}
        <div className="shrink-0 flex flex-col gap-[3px] px-0.5">
          {grid.map((row, ri) => (
            <div key={ri} className="flex gap-[3px]">
              {row.map((level, ci) => {
                const isBlinking = aiIsStreaming && ci === streamingCol && ri === ROWS - 1;
                return (
                  <div
                    key={ci}
                    className={isBlinking ? 'tpg-blink' : undefined}
                    title={
                      ci < samples.length
                        ? `Turn ${ci + 1}: ${samples[ci].tokens.toLocaleString()} tokens`
                        : undefined
                    }
                    style={{
                      flex: 1,
                      aspectRatio: '1 / 1',
                      borderRadius: '2px',
                      background: LEVELS[level],
                      transition: 'background 0.4s ease',
                      boxShadow:
                        level >= 3
                          ? `0 0 4px ${ACCENT}44`
                          : level >= 2
                            ? `0 0 2px ${ACCENT}22`
                            : undefined,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Context window bar ─────────────────────────────────────────── */}
        {aiContextLimit > 0 && (
          <div className="shrink-0 flex flex-col gap-1 px-0.5">
            <div className="flex justify-between items-baseline">
              <span
                className="text-[9px] font-mono uppercase tracking-wider"
                style={{ color: 'rgba(57,211,83,0.3)' }}
              >
                Context window
              </span>
              <span
                className="text-[10px] font-mono tabular-nums"
                style={{
                  color: contextPct >= 90 ? '#ef4444' : contextPct >= 75 ? '#f59e0b' : 'rgba(57,211,83,0.55)',
                }}
              >
                {contextPct}%
              </span>
            </div>
            <div
              className="w-full rounded-full overflow-hidden"
              style={{ height: '3px', background: 'rgba(255,255,255,0.05)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${contextPct}%`,
                  background:
                    contextPct >= 90
                      ? '#ef4444'
                      : contextPct >= 75
                        ? '#f59e0b'
                        : `linear-gradient(90deg, #006d32, ${ACCENT})`,
                  boxShadow: contextPct > 5 ? `0 0 5px ${ACCENT}55` : 'none',
                }}
              />
            </div>
          </div>
        )}

        {/* ── Stats strip ────────────────────────────────────────────────── */}
        <div
          className="shrink-0 grid grid-cols-3 gap-1 rounded-md px-2 py-1.5"
          style={{ background: 'rgba(57,211,83,0.04)', border: '1px solid rgba(57,211,83,0.08)' }}
        >
          {[
            {
              label: 'Context',
              value: aiContextLimit > 0
                ? `${fmt(aiContextUsed)} / ${fmt(aiContextLimit)}`
                : '—',
              highlight: false,
            },
            {
              label: 'Speed',
              value: aiIsStreaming && aiLiveTokPerSec !== null ? fmtRate(aiLiveTokPerSec) : '—',
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
              <span
                className="text-[8px] font-mono uppercase tracking-widest"
                style={{ color: 'rgba(57,211,83,0.25)' }}
              >
                {label}
              </span>
              <span
                className="text-[10px] font-mono tabular-nums"
                style={{ color: highlight ? ACCENT : 'rgba(255,255,255,0.45)' }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* ── Footer legend (GitHub style) ────────────────────────────────── */}
        <div className="shrink-0 flex items-center justify-end gap-1 px-0.5">
          <span
            className="text-[8px] font-mono"
            style={{ color: 'rgba(57,211,83,0.2)' }}
          >
            less
          </span>
          {LEVELS.map((c, i) => (
            <div
              key={i}
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '2px',
                background: c,
                boxShadow: i >= 3 ? `0 0 3px ${ACCENT}44` : undefined,
              }}
            />
          ))}
          <span
            className="text-[8px] font-mono"
            style={{ color: 'rgba(57,211,83,0.2)' }}
          >
            more
          </span>
        </div>

      </div>
    </div>
  );
};

export default TokenPowerGrid;
