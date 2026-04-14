/**
 * TokenStatusStrip — compact token/activity status display for the AI footer.
 *
 * Shows orchestrator and coder token totals during agent runs, a live tok/s
 * counter when the model is streaming, and a pulsing activity indicator when
 * the agent is executing tools between rounds.
 *
 * Extracted from AIPanel.tsx so the display logic is in a small focused file
 * that's easy to update without touching the large AIPanel controller.
 */

import React from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTokenCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentTokenCounts {
  orchestrator: { in: number; out: number };
  coder: { in: number; out: number };
}

export interface TokenStatusStripProps {
  /** Whether the agent loop is currently running (show token totals). */
  isAgentLoopActive: boolean;
  /** Per-agent accumulated token counts. */
  agentTokens: AgentTokenCounts;
  /** Whether the model is actively streaming a response. */
  isThinking: boolean;
  /** Live tokens-per-second rate while streaming; null when not streaming. */
  liveTokPerSec: number | null;
  /** Whether the agent loop is busy (running tools between streaming rounds). */
  isAgentBusy: boolean;
  /** Current agent loop status text shown during tool execution. */
  agentLoopStatus: string;
  /** Content being streamed in regular chat mode (not agent). */
  streamingContent?: string;
  /** Progress detector for non-agent streaming. */
  detectStreamProgress?: (content: string) => string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TokenStatusStrip({
  isAgentLoopActive,
  agentTokens,
  isThinking,
  liveTokPerSec,
  isAgentBusy,
  agentLoopStatus,
  streamingContent,
  detectStreamProgress,
}: TokenStatusStripProps) {
  if (isAgentLoopActive) {
    return (
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        {/* Orchestrator total — violet */}
        {agentTokens.orchestrator.in + agentTokens.orchestrator.out > 0 && (
          <span
            className="font-mono text-[11px] tabular-nums text-violet-400 shrink-0"
            title={`Orchestrator — in: ${formatTokenCount(agentTokens.orchestrator.in)} / out: ${formatTokenCount(agentTokens.orchestrator.out)}`}
          >
            {formatTokenCount(agentTokens.orchestrator.in + agentTokens.orchestrator.out)}
          </span>
        )}
        {/* Coder total — blue */}
        {agentTokens.coder.in + agentTokens.coder.out > 0 && (
          <span
            className="font-mono text-[11px] tabular-nums text-blue-400/80 shrink-0"
            title={`Coder — in: ${formatTokenCount(agentTokens.coder.in)} / out: ${formatTokenCount(agentTokens.coder.out)}`}
          >
            coder {formatTokenCount(agentTokens.coder.in + agentTokens.coder.out)}
          </span>
        )}
        {/* Live tok/s while streaming */}
        {isThinking && liveTokPerSec !== null && (
          <span className="font-mono text-[11px] text-primary/80 tabular-nums shrink-0">
            {liveTokPerSec} tok/s
          </span>
        )}
        {/* Between-rounds activity pulse */}
        {isAgentBusy && !isThinking && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" />
            {agentLoopStatus || 'running…'}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Regular chat: live tok/s */}
      {isThinking && liveTokPerSec !== null && (
        <span className="font-mono text-[11px] text-primary/80 tabular-nums shrink-0">
          {liveTokPerSec} tok/s
        </span>
      )}
      {/* Regular chat: streaming progress */}
      {isThinking && streamingContent && detectStreamProgress && (
        <span className="text-[10px] text-primary/70 truncate min-w-0 hidden sm:block">
          {detectStreamProgress(streamingContent)}
        </span>
      )}
    </>
  );
}
