import { useState } from 'react';
import { AlertTriangle, RefreshCw, SkipForward, StopCircle, Lightbulb, ChevronDown, ChevronRight, Brain, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useTaskStore } from '@/store/taskStore';

export function EscalationDialog() {
  const escalationContext = useTaskStore(s => s.escalationContext);
  const resolveEscalation = useTaskStore(s => s.resolveEscalation);

  const [hint, setHint] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showingHintInput, setShowingHintInput] = useState(false);

  const isOpen = escalationContext !== null;

  const handleContinue = () => {
    resolveEscalation({ action: 'continue' });
    setHint('');
    setShowingHintInput(false);
  };

  const handleOrchestratorReplan = () => {
    resolveEscalation({ action: 'orchestrator_replan' });
    setHint('');
    setShowingHintInput(false);
  };

  const handleHint = () => {
    if (!hint.trim()) return;
    resolveEscalation({ action: 'hint', hint: hint.trim() });
    setHint('');
    setShowingHintInput(false);
  };

  const handleSkip = () => {
    resolveEscalation({ action: 'skip' });
    setHint('');
    setShowingHintInput(false);
  };

  const handleStop = () => {
    resolveEscalation({ action: 'stop' });
    setHint('');
    setShowingHintInput(false);
  };

  if (!isOpen || !escalationContext) return null;

  const { stepDescription, attemptCount, errorSummary, attemptHistory } = escalationContext;

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-xl w-full bg-background border-warning/40 shadow-2xl"
        onInteractOutside={e => e.preventDefault()}
      >
        {/* Hide the default close button — user must explicitly choose an action */}
        <style>{`[data-radix-dialog-close]{display:none}`}</style>

        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <DialogTitle className="text-base font-semibold text-warning">
              Agent is stuck — your input needed
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1 space-y-1">
            <span>
              After {attemptCount} repair attempt{attemptCount !== 1 ? 's' : ''}, the agent couldn't fix this step automatically.
            </span>
            {attemptCount >= 3 && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                <Brain className="h-3 w-3 shrink-0" />
                The orchestrator already tried a fresh strategy — this is a genuine blocker.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Step being repaired */}
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Step</p>
            <p className="text-sm text-foreground font-medium leading-snug">{stepDescription}</p>
          </div>

          {/* Error summary */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Last error</p>
            <pre className="text-[11px] text-destructive bg-destructive/8 border border-destructive/20 rounded p-2.5 overflow-x-auto whitespace-pre-wrap break-words max-h-32 overflow-y-auto leading-relaxed font-mono">
              {errorSummary || 'No error details available.'}
            </pre>
          </div>

          {/* Attempt history (collapsible) */}
          {attemptHistory.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowHistory(v => !v)}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
              >
                {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                What was tried ({attemptHistory.length} attempt{attemptHistory.length !== 1 ? 's' : ''})
              </button>
              {showHistory && (
                <ul className="mt-1.5 space-y-1">
                  {attemptHistory.map((h, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1 leading-relaxed font-mono">
                      {i + 1}. {h}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Hint input */}
        {showingHintInput && (
          <div className="space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Your hint (the agent will use this in the next repair attempt)
            </p>
            <textarea
              autoFocus
              value={hint}
              onChange={e => setHint(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleHint(); }}
              placeholder="e.g. Try deleting node_modules first, or use yarn instead of npm…"
              className="w-full min-h-[4rem] text-[12px] bg-input text-foreground border border-border/60 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/80 placeholder:text-muted-foreground"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleHint}
                disabled={!hint.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                Send hint &amp; retry
              </button>
              <button
                type="button"
                onClick={() => setShowingHintInput(false)}
                className="px-3 py-2 rounded-md bg-secondary text-secondary-foreground text-[12px] hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!showingHintInput && (
          <div className="space-y-2 pt-1">
            {/* Primary: orchestrator replan */}
            <button
              type="button"
              onClick={handleOrchestratorReplan}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-400 text-[12px] font-semibold hover:bg-violet-500/25 transition-colors"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Ask orchestrator for a new strategy
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleContinue}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-primary/10 border border-primary/30 text-primary text-[12px] font-medium hover:bg-primary/20 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Keep trying
              </button>

              <button
                type="button"
                onClick={() => setShowingHintInput(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[12px] font-medium hover:bg-amber-500/20 transition-colors"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                Give a hint
              </button>

              <button
                type="button"
                onClick={handleSkip}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-secondary border border-border text-muted-foreground text-[12px] font-medium hover:bg-secondary/80 hover:text-foreground transition-colors"
              >
                <SkipForward className="h-3.5 w-3.5" />
                Skip this step
              </button>

              <button
                type="button"
                onClick={handleStop}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-[12px] font-medium hover:bg-destructive/20 transition-colors"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Stop plan
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
