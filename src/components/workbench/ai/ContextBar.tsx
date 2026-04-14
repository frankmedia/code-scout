/**
 * ContextBar — compact token usage progress bar for the AI footer.
 *
 * Shows estimated token usage vs context limit with colour-coded warnings.
 * Offers a "New chat →" button when the context window is nearly full.
 *
 * Extracted from AIPanel.tsx to give this self-contained display component
 * its own focused module.
 */

import React from 'react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTokenCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ContextBarProps {
  used: number;
  limit: number;
  onNewChat: () => void;
  /** Extra tooltip copy (e.g. how the estimate is built). */
  titleDetail?: string;
}

export function ContextBar({ used, limit, onNewChat, titleDetail }: ContextBarProps) {
  if (limit <= 0) return null;
  const ratio = Math.min(1, used / limit);
  const pct = Math.round(ratio * 100);
  const danger = ratio >= 0.9;
  const warn = ratio >= 0.8;
  const fillClass = danger ? 'bg-destructive' : warn ? 'bg-warning' : 'bg-primary/70';
  const labelClass = danger ? 'text-destructive' : warn ? 'text-warning' : 'text-muted-foreground';

  const tip =
    `~${formatTokenCount(used)} / ${formatTokenCount(limit)} tokens (rough estimate). ` +
    `Max context is inferred from the model id unless you set **Context** on the model in Settings. ` +
    (titleDetail ? titleDetail : '');

  return (
    <div className="flex items-center gap-2 min-w-0 shrink-0" title={tip}>
      <div className="flex flex-col gap-1 min-w-0">
        <span className={`text-xs font-mono tabular-nums whitespace-nowrap ${labelClass}`}>
          ~{formatTokenCount(used)} / {formatTokenCount(limit)}
        </span>
        <div className="h-1.5 w-36 rounded-full bg-border overflow-hidden">
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
          className={`text-xs font-medium shrink-0 hover:underline transition-colors ${danger ? 'text-destructive' : 'text-warning'}`}
          title="Context window is nearly full — start a fresh conversation"
        >
          New chat →
        </button>
      )}
    </div>
  );
}
