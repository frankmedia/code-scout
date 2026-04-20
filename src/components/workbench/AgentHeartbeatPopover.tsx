/**
 * Agent heartbeat & loop limits — compact popover for the top bar.
 * Uses sliders + value chips for quick tuning; mirrors Model Settings values.
 */
import type { ReactNode } from 'react';
import {
  Activity,
  BookOpen,
  Heart,
  Layers,
  RotateCcw,
  Timer,
  Undo2,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useModelStore } from '@/store/modelStore';
import { cn } from '@/lib/utils';

type SliderRowProps = {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onValueChange: (v: number) => void;
};

function SliderRow({ label, hint, value, min, max, step, format, onValueChange }: SliderRowProps) {
  const safe = Math.min(max, Math.max(min, value));
  const display = format ? format(safe) : String(safe);
  return (
    <div className="space-y-2 py-2.5 first:pt-0 border-t border-border/60 first:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground leading-tight">{label}</p>
          {hint && <p className="text-[9px] text-muted-foreground mt-0.5 leading-snug">{hint}</p>}
        </div>
        <span
          className="shrink-0 font-mono text-[10px] tabular-nums px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20"
          title="Current value"
        >
          {display}
        </span>
      </div>
      <Slider
        value={[safe]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => {
          const next = v[0];
          if (next !== undefined) onValueChange(next);
        }}
        className="py-1 [&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_.relative.h-2]:h-1.5"
      />
    </div>
  );
}

type SectionProps = {
  title: string;
  icon: ReactNode;
  accent: string;
  children: React.ReactNode;
};

function Section({ title, icon, accent, children }: SectionProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 overflow-hidden',
        'bg-gradient-to-b from-muted/40 to-muted/5 dark:from-muted/20 dark:to-transparent',
        'shadow-sm',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 border-b border-border/60',
          'bg-muted/30',
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg border shadow-sm',
            accent,
          )}
        >
          {icon}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/90">{title}</span>
      </div>
      <div className="px-3 pb-1">{children}</div>
    </div>
  );
}

interface AgentHeartbeatPopoverProps {
  onOpenModelSettings: () => void;
}

export function AgentHeartbeatPopover({ onOpenModelSettings }: AgentHeartbeatPopoverProps) {
  const {
    agentHeartbeatIntervalMs,
    agentStallWarningAfterMs,
    agentMaxNoToolRounds,
    agentMaxRounds,
    agentRepetitionNudgeAt,
    agentRepetitionExitAt,
    agentMaxCoderRounds,
    agentMaxFileReadChars,
    agentHistoryMessages,
    agentBackgroundSettleMs,
    setAgentHeartbeatIntervalMs,
    setAgentHeartbeatEnabled,
    setAgentStallWarningAfterMs,
    setAgentMaxNoToolRounds,
    setAgentMaxRounds,
    setAgentRepetitionNudgeAt,
    setAgentRepetitionExitAt,
    setAgentMaxCoderRounds,
    setAgentMaxFileReadChars,
    setAgentHistoryMessages,
    setAgentBackgroundSettleMs,
    resetAgentLoopLimitsToDefaults,
  } = useModelStore();

  const heartbeatOn = agentHeartbeatIntervalMs > 0;
  const hbSec = Math.max(5, Math.round(agentHeartbeatIntervalMs / 1000));
  const stallSec = Math.round(agentStallWarningAfterMs / 1000);
  const bgSec = Math.round(agentBackgroundSettleMs / 1000);

  return (
    <div
      className={cn(
        'absolute right-0 top-full mt-1.5 z-50 w-[20.5rem] sm:w-[22rem]',
        'rounded-xl border border-border shadow-xl shadow-black/10 dark:shadow-black/40',
        'bg-popover/95 backdrop-blur-md',
        'max-h-[min(85dvh,560px)] overflow-y-auto',
      )}
    >
      <div className="sticky top-0 z-10 px-3.5 pt-3.5 pb-2 bg-popover/95 backdrop-blur-md border-b border-border/60">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500/20 to-amber-500/15 border border-rose-500/20">
            <Activity className="h-4 w-4 text-rose-500 dark:text-rose-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground leading-tight">Agent loop</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Heartbeat, limits &amp; context</p>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <Section
          title="Heartbeat"
          icon={<Heart className="h-3.5 w-3.5 text-red-600 dark:text-red-500" />}
          accent="bg-red-500/10 border-red-500/25"
        >
          <div className="flex items-center justify-between gap-3 py-2.5 border-b border-border/60">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">Agent heartbeat</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                {heartbeatOn ? 'Periodic check-ins during long agent runs' : 'Off — agent runs without heartbeat timers'}
              </p>
            </div>
            <Switch
              checked={heartbeatOn}
              onCheckedChange={setAgentHeartbeatEnabled}
              className="data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600 shrink-0"
              aria-label="Toggle agent heartbeat"
            />
          </div>
          {heartbeatOn && (
            <SliderRow
              label="Check every"
              hint="How often to ping the agent loop so it doesn’t go silent."
              value={hbSec}
              min={5}
              max={120}
              step={5}
              format={(v) => `${v}s`}
              onValueChange={(v) => setAgentHeartbeatIntervalMs(v * 1000)}
            />
          )}
          <SliderRow
            label="Stall warning"
            hint="0 = off. Log a warning if no tool runs for this long."
            value={stallSec}
            min={0}
            max={180}
            step={5}
            format={(v) => (v === 0 ? 'Off' : `${v}s`)}
            onValueChange={(v) => setAgentStallWarningAfterMs(v * 1000)}
          />
        </Section>

        <Section
          title="Loop limits"
          icon={<Layers className="h-3.5 w-3.5 text-sky-500" />}
          accent="bg-sky-500/10 border-sky-500/25"
        >
          <SliderRow
            label="Agent rounds"
            hint="Max orchestrator tool rounds per run (shell, web_search, delegate_to_coder, …)."
            value={agentMaxRounds}
            min={10}
            max={200}
            step={5}
            format={(v) => `${v} rounds`}
            onValueChange={setAgentMaxRounds}
          />
          <SliderRow
            label="Coder rounds"
            hint="Per delegation to the Coder model."
            value={agentMaxCoderRounds}
            min={5}
            max={120}
            step={5}
            format={(v) => `${v} rounds`}
            onValueChange={setAgentMaxCoderRounds}
          />
          <SliderRow
            label="No-tool rounds"
            hint="Stop after this many orchestrator turns in a row with no tool calls (text-only)."
            value={agentMaxNoToolRounds}
            min={1}
            max={100}
            step={1}
            onValueChange={setAgentMaxNoToolRounds}
          />
          <button
            type="button"
            onClick={resetAgentLoopLimitsToDefaults}
            className="mt-2 mb-1 w-full flex items-center justify-center gap-2 rounded-lg border border-border/80 bg-muted/30 px-3 py-2 text-[10px] font-medium text-foreground hover:bg-muted/50 transition-colors"
          >
            <Undo2 className="h-3.5 w-3.5 opacity-70" aria-hidden />
            Reset loop settings &amp; timeouts
          </button>
        </Section>

        <Section
          title="Repetition guard"
          icon={<RotateCcw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
          accent="bg-amber-500/10 border-amber-500/25"
        >
          <SliderRow
            label="Nudge at"
            hint="Same tool + args repeated this many times → inject a strategy nudge."
            value={agentRepetitionNudgeAt}
            min={1}
            max={100}
            step={1}
            format={(v) => `×${v}`}
            onValueChange={setAgentRepetitionNudgeAt}
          />
          <SliderRow
            label="Force-stop at"
            hint="Hard stop if identical tool calls keep repeating."
            value={agentRepetitionExitAt}
            min={2}
            max={100}
            step={1}
            format={(v) => `×${v}`}
            onValueChange={setAgentRepetitionExitAt}
          />
        </Section>

        <Section
          title="Context & I/O"
          icon={<BookOpen className="h-3.5 w-3.5 text-violet-500" />}
          accent="bg-violet-500/10 border-violet-500/25"
        >
          <SliderRow
            label="File read cap"
            hint="Max characters returned per read_file."
            value={agentMaxFileReadChars}
            min={2000}
            max={50000}
            step={1000}
            format={(v) => (v % 1000 === 0 ? `${v / 1000}k` : `${(v / 1000).toFixed(1)}k`)}
            onValueChange={setAgentMaxFileReadChars}
          />
          <SliderRow
            label="History messages"
            hint="Chat turns kept in agent context."
            value={agentHistoryMessages}
            min={5}
            max={100}
            step={5}
            format={(v) => `${v} msgs`}
            onValueChange={setAgentHistoryMessages}
          />
          <SliderRow
            label="Background settle"
            hint="Seconds to wait after starting a background command."
            value={bgSec}
            min={1}
            max={30}
            step={1}
            format={(v) => `${v}s`}
            onValueChange={(v) => setAgentBackgroundSettleMs(v * 1000)}
          />
        </Section>

        <button
          type="button"
          onClick={onOpenModelSettings}
          className="w-full text-left rounded-lg border border-border/80 bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors flex items-center gap-2"
        >
          <Timer className="h-3 w-3 shrink-0 opacity-70" />
          <span>
            More options and model wiring in <span className="font-semibold text-foreground">Model Settings</span>.
          </span>
        </button>
      </div>
    </div>
  );
}
