/**
 * AgentStatusPanel — visual phase tracker for agent execution.
 * Shows a horizontal phase pipeline (Inspect → Code → Verify → Done)
 * with animated transitions and progress indicators.
 */

import { CheckCircle2, Search, Code2, ShieldCheck, Sparkles, Loader2 } from 'lucide-react';

export type AgentPhase = 'inspect' | 'code' | 'verify' | 'done' | 'idle';

const PHASES: { id: AgentPhase; label: string; icon: React.ReactNode }[] = [
  { id: 'inspect', label: 'Inspect',  icon: <Search className="h-3 w-3" /> },
  { id: 'code',    label: 'Code',     icon: <Code2 className="h-3 w-3" /> },
  { id: 'verify',  label: 'Verify',   icon: <ShieldCheck className="h-3 w-3" /> },
  { id: 'done',    label: 'Done',     icon: <Sparkles className="h-3 w-3" /> },
];

function phaseIndex(phase: AgentPhase): number {
  const i = PHASES.findIndex(p => p.id === phase);
  return i >= 0 ? i : -1;
}

/** Infer the current phase from the agent status string. */
export function inferPhaseFromStatus(status: string): AgentPhase {
  const s = status.toLowerCase();
  // LLM in flight — show as Code with spinner, not idle (avoids "frozen pipeline" UX).
  if (/\b(waiting for model|on provider)/.test(s)) return 'code';
  if (/\b(re-prompt|tool_choice)/.test(s)) return 'idle';
  if (/^(read|list|search|inspect|scanning|indexing)/.test(s)) return 'inspect';
  if (/web search|fetch url|browse page|search in files/.test(s)) return 'inspect';
  if (/^(writ|edit|creat|delet|coder|generat|code)/.test(s)) return 'code';
  if (/^(verif|build|test|repair|validat|check|running\s+(npm|pnpm|yarn|bun|cargo))/.test(s)) return 'verify';
  if (/^(done|complet|finish|all steps)/.test(s)) return 'done';
  return 'code'; // default to code phase
}

interface AgentStatusPanelProps {
  phase: AgentPhase;
  stepCurrent?: number;
  stepTotal?: number;
}

export function AgentStatusPanel({ phase, stepCurrent, stepTotal }: AgentStatusPanelProps) {
  const activeIdx = phaseIndex(phase);

  return (
    <div className="flex items-center gap-0.5 select-none">
      {PHASES.map((p, i) => {
        const isCurrent = i === activeIdx;
        const isDone = i < activeIdx;

        return (
          <div key={p.id} className="flex items-center gap-0.5">
            {i > 0 && (
              <div
                className={`w-3 h-px transition-colors duration-300 ${
                  isDone ? 'bg-success/60' : 'bg-zinc-400/55 dark:bg-border/50'
                }`}
              />
            )}
            <div
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all duration-300 ${
                isCurrent
                  ? 'bg-primary/15 text-primary border border-primary/30'
                  : isDone
                  ? 'bg-success/10 text-success/80'
                  : 'text-zinc-600 dark:text-muted-foreground'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-2.5 w-2.5" />
              ) : isCurrent ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <span className="text-zinc-600 dark:text-muted-foreground [&_svg]:shrink-0">{p.icon}</span>
              )}
              <span>{p.label}</span>
            </div>
          </div>
        );
      })}

      {stepTotal != null && stepTotal > 0 && (
        <span className="ml-2 text-[10px] text-zinc-600 dark:text-muted-foreground font-mono tabular-nums">
          {stepCurrent ?? 0}/{stepTotal}
        </span>
      )}
    </div>
  );
}
