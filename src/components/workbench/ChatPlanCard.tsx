/**
 * ChatPlanCard — Inline plan display inside chat messages.
 * Shows plan steps, execute/reject buttons, and live execution progress
 * so the user never has to leave the chat tab.
 */
import { useState, useCallback } from 'react';
import {
  Play,
  X,
  Pencil,
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  Undo2,
  FileText,
  FilePlus,
  Trash2,
  Terminal,
  Wrench,
  Globe,
  Search,
} from 'lucide-react';
import { useWorkbenchStore, type PlanStep } from '@/store/workbenchStore';
import { useModelStore } from '@/store/modelStore';
import { orchestrator } from '@/services/orchestrator';
// callModel removed — onComplete now posts results directly without model calls
import { submitPlanRevision, submitPlanCompletion } from '@/services/planRevisionBridge';
import { planExecutionProgressSuffix } from '@/utils/planExecutionUi';

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create_file: <FilePlus className="h-3 w-3" />,
  edit_file: <FileText className="h-3 w-3" />,
  delete_file: <Trash2 className="h-3 w-3" />,
  run_command: <Terminal className="h-3 w-3" />,
  web_search: <Search className="h-3 w-3" />,
  fetch_url: <Globe className="h-3 w-3" />,
  browse_web: <Globe className="h-3 w-3" />,
};

function StepIcon({ status }: { status: PlanStep['status'] }) {
  switch (status) {
    case 'pending':
      return <Circle className="h-3 w-3 text-muted-foreground" />;
    case 'running':
      return <Loader2 className="h-3 w-3 text-primary animate-spin" />;
    case 'repairing':
      return <Wrench className="h-3 w-3 text-warning animate-pulse" />;
    case 'done':
      return <CheckCircle2 className="h-3 w-3 text-success" />;
    case 'error':
      return <XCircle className="h-3 w-3 text-destructive" />;
  }
}

export function ChatPlanCard() {
  const plan = useWorkbenchStore(s => s.currentPlan);
  const updatePlanStatus = useWorkbenchStore(s => s.updatePlanStatus);
  const updateStepStatus = useWorkbenchStore(s => s.updateStepStatus);
  const updateStepLiveOutput = useWorkbenchStore(s => s.updateStepLiveOutput);
  const updateStepServerUrl = useWorkbenchStore(s => s.updateStepServerUrl);
  const addLog = useWorkbenchStore(s => s.addLog);
  const addMessage = useWorkbenchStore(s => s.addMessage);
  const addTerminalOutput = useWorkbenchStore(s => s.addTerminalOutput);
  const setMode = useWorkbenchStore(s => s.setMode);
  const fileHistory = useWorkbenchStore(s => s.fileHistory);
  const rollbackAll = useWorkbenchStore(s => s.rollbackAll);
  const getModelForRole = useModelStore(s => s.getModelForRole);

  const [skippedSteps, setSkippedSteps] = useState<Set<string>>(new Set());
  const [showRevise, setShowRevise] = useState(false);
  const [reviseText, setReviseText] = useState('');
  const [reviseBusy, setReviseBusy] = useState(false);

  const toggleSkip = (stepId: string) => {
    setSkippedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleExecute = useCallback(async () => {
    if (!plan) return;
    setMode('agent');
    updatePlanStatus('executing');

    for (const stepId of skippedSteps) {
      updateStepStatus(stepId, 'done');
    }

    const stepsToRun = plan.steps.filter(s => !skippedSteps.has(s.id));
    const skippedCount = skippedSteps.size;

    addLog('Plan approved — executing...', 'success');
    addMessage({
      role: 'assistant',
      agent: 'coder',
      content: `Plan approved! Executing ${stepsToRun.length} step${stepsToRun.length !== 1 ? 's' : ''}...${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`,
    });
    addTerminalOutput('▶ Starting plan runner (first step begins after workspace prep)…');

    const coderModel = getModelForRole('coder');

    try {
      await orchestrator.executePlan(
      plan,
      skippedSteps,
      {
        onStepStart: step => {
          updateStepStatus(step.id, 'running');
          addTerminalOutput(`> Step: ${step.description}`);
        },
        onStepDone: step => {
          updateStepStatus(step.id, 'done');
        },
        onStepError: (step, _idx, err) => {
          updateStepStatus(step.id, 'error', err);
        },
        onRepairStart: step => {
          updateStepStatus(step.id, 'repairing');
        },
        onStepOutput: (step, line) => {
          updateStepLiveOutput(step.id, line);
        },
        onStepServerUrl: (step, url) => {
          updateStepServerUrl(step.id, url);
        },
        onPlanStoppedEarly: (reason) => {
          updatePlanStatus('done');
          addMessage({
            role: 'assistant',
            agent: 'coder',
            content: `**Plan stopped** — validation or repair failed.\n\n${reason.slice(0, 3500)}`,
          });
        },
        onComplete: () => {
          updatePlanStatus('done');
          const planState = useWorkbenchStore.getState().currentPlan;
          const failed = planState?.steps.filter(s => s.status === 'error').length ?? 0;
          const serverSteps = planState?.steps.filter(s => s.serverUrl) ?? [];
          const urlList = serverSteps.map(s => `**${s.serverUrl}**`).join(' · ');

          // Build step results — always posted immediately, no model call needed
          const stepResults = (planState?.steps ?? []).map((s, i) => {
            let result = `Step ${i + 1}: ${s.description} — ${s.status}`;
            if (s.fullOutput?.trim()) result += `\nOutput:\n${s.fullOutput.trim().slice(0, 2000)}`;
            if (s.errorMessage) result += `\nError: ${s.errorMessage}`;
            return result;
          }).join('\n\n');

          // Post to chat IMMEDIATELY — never wait for any model call
          let completionMsg: string;
          if (failed > 0) {
            completionMsg = `Finished with **${failed} failed step(s)**.\n\n${stepResults.slice(0, 4000)}`;
          } else if (urlList) {
            completionMsg = `All steps completed! App running at ${urlList}.${stepResults ? `\n\n---\n${stepResults.slice(0, 4000)}` : ''}`;
          } else if (stepResults.trim()) {
            completionMsg = `All steps completed.\n\n---\n${stepResults.slice(0, 4000)}`;
          } else {
            completionMsg = 'All steps completed!';
          }
          addMessage({ role: 'assistant', agent: 'coder', content: completionMsg });

          // Fire orchestrator evaluation — completely non-blocking
          const originalGoal = [...useWorkbenchStore.getState().messages]
            .reverse()
            .find(m => m.role === 'user')?.content ?? '';
          addTerminalOutput('[LOOP] plan complete → submitPlanCompletion');
          void submitPlanCompletion(stepResults, originalGoal);
        },
        onLog: (message, type) => addLog(message, type),
      },
      coderModel,
    );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updatePlanStatus('done');
      const st = useWorkbenchStore.getState().currentPlan;
      const stuck = st?.steps.find(s => s.status === 'running' || s.status === 'repairing');
      if (stuck) updateStepStatus(stuck.id, 'error', msg);
      addLog(`Plan execution failed: ${msg}`, 'error');
      addMessage({
        role: 'assistant',
        agent: 'coder',
        content: `**Plan execution stopped** — ${msg.slice(0, 3500)}`,
      });
    }
  }, [plan, skippedSteps, setMode, updatePlanStatus, updateStepStatus, addLog, addMessage, addTerminalOutput, getModelForRole, updateStepLiveOutput, updateStepServerUrl]);

  const handleReject = useCallback(() => {
    updatePlanStatus('rejected');
    addLog('Plan rejected by user', 'warning');
    addMessage({
      role: 'assistant',
      agent: 'orchestrator',
      content: "Plan rejected. No files were modified. Tell me what you'd like to change.",
    });
  }, [updatePlanStatus, addLog, addMessage]);

  const handleRegeneratePlan = useCallback(async () => {
    const t = reviseText.trim();
    if (!t || reviseBusy) return;
    setReviseBusy(true);
    try {
      await submitPlanRevision(t);
      setReviseText('');
      setShowRevise(false);
    } finally {
      setReviseBusy(false);
    }
  }, [reviseText, reviseBusy]);

  const handleRollback = useCallback(() => {
    rollbackAll();
    addLog('All changes rolled back', 'warning');
    addMessage({
      role: 'assistant',
      agent: 'coder',
      content: 'All file changes have been rolled back to their original state.',
    });
  }, [rollbackAll, addLog, addMessage]);

  if (!plan || plan.status === 'rejected') return null;

  const isPending = plan.status === 'pending';
  const isExecuting = plan.status === 'executing';
  const isDone = plan.status === 'done';
  const errorCount = plan.steps.filter(s => s.status === 'error').length;
  const doneCount = plan.steps.filter(s => s.status === 'done').length;
  const total = plan.steps.length;

  return (
    <div className="mt-2 not-prose rounded-md border border-border bg-secondary/40 text-xs overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground truncate">{plan.summary}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {total} step{total !== 1 ? 's' : ''}
            {isPending && skippedSteps.size > 0 && ` · ${skippedSteps.size} skipped`}
            {isExecuting && ` · ${planExecutionProgressSuffix(plan.steps)}`}
            {isDone && (errorCount > 0 ? ` · ${errorCount} failed` : ' · complete')}
          </p>
          {(plan.validationCommand || isExecuting) && (
            <p className="text-[9px] font-mono text-muted-foreground/80 mt-0.5 truncate">
              Validate: {plan.validationCommand?.trim() || '(auto)'}
            </p>
          )}
        </div>
        {isPending && (
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExecute}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Play className="h-3 w-3" />
                Execute
              </button>
              <button
                type="button"
                onClick={() => setShowRevise(v => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-hover"
              >
                <Pencil className="h-3 w-3" />
                Modify
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-hover"
              >
                <X className="h-3 w-3" />
                Reject
              </button>
            </div>
            {showRevise && (
              <div className="w-full max-w-[min(100%,280px)] flex flex-col gap-1.5 rounded-md border border-border bg-background/80 p-2">
                <label className="text-[10px] text-muted-foreground" htmlFor="plan-revise-chat">
                  What should change?
                </label>
                <textarea
                  id="plan-revise-chat"
                  value={reviseText}
                  onChange={e => setReviseText(e.target.value)}
                  rows={3}
                  placeholder="e.g. Skip the DB step, add tests first…"
                  className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/70"
                  disabled={reviseBusy}
                />
                <button
                  type="button"
                  onClick={() => void handleRegeneratePlan()}
                  disabled={reviseBusy || !reviseText.trim()}
                  className="inline-flex items-center justify-center gap-1 rounded-md bg-primary/90 px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary disabled:opacity-50"
                >
                  {reviseBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />}
                  Regenerate plan
                </button>
              </div>
            )}
          </div>
        )}
        {isDone && fileHistory.length > 0 && (
          <button
            type="button"
            onClick={handleRollback}
            className="inline-flex items-center gap-1 rounded-md bg-warning/15 text-warning px-2 py-1 text-[11px] font-medium hover:bg-warning/25 shrink-0"
          >
            <Undo2 className="h-3 w-3" />
            Rollback
          </button>
        )}
      </div>

      {/* Steps */}
      <div className="max-h-64 overflow-y-auto">
        {plan.steps.map(step => {
          const isSkipped = skippedSteps.has(step.id);
          return (
            <div
              key={step.id}
              className={`flex items-start gap-2 px-3 py-1.5 border-b border-border/30 last:border-b-0 ${
                step.status === 'running' ? 'bg-primary/5' : ''
              } ${step.status === 'repairing' ? 'bg-warning/10' : ''} ${isSkipped ? 'opacity-40' : ''}`}
            >
              {/* Status icon */}
              <div className="mt-0.5 shrink-0">
                {isSkipped && isPending ? (
                  <Ban className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <StepIcon status={step.status} />
                )}
              </div>

              {/* Step info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-muted-foreground shrink-0">{ACTION_ICONS[step.action] || <Terminal className="h-3 w-3" />}</span>
                  <span className={`text-[11px] ${isSkipped ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {step.description}
                  </span>
                  {step.repairAttemptCount != null && step.repairAttemptCount > 0 && (
                    <span className="text-[9px] px-1 rounded bg-warning/15 text-warning shrink-0">
                      repairing… attempt {step.repairAttemptCount}
                    </span>
                  )}
                </div>
                {step.path && (
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">{step.path}</p>
                )}
                {step.command && (step.action === 'fetch_url' || step.action === 'browse_web') ? (
                  <a
                    href={step.command}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono text-primary/80 hover:underline mt-0.5 truncate block"
                  >
                    🌐 {step.command}
                  </a>
                ) : step.command ? (
                  <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">$ {step.command}</p>
                ) : null}
                {/* Live output while running */}
                {step.status === 'running' && step.liveOutput && !step.fullOutput && (
                  <p className="mt-0.5 text-[10px] font-mono text-muted-foreground/60 truncate">{step.liveOutput}</p>
                )}
                {/* Streaming / accumulated output */}
                {step.fullOutput && (step.status === 'running' || step.status === 'done') && (
                  <pre className="mt-1 max-h-32 overflow-y-auto rounded bg-background/50 p-1.5 text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all">
                    {step.fullOutput.length > 3000 ? step.fullOutput.slice(-3000) + '\n...(truncated)' : step.fullOutput.trimEnd()}
                  </pre>
                )}
                {step.status === 'repairing' && step.lastValidationError && (
                  <p className="mt-0.5 text-[10px] text-warning font-mono break-words">
                    Repairing… {step.lastValidationError.slice(0, 320)}
                  </p>
                )}
                {step.status === 'error' && (step.stopDiagnostic || step.errorMessage) && (
                  <p className="mt-0.5 text-[10px] text-destructive whitespace-pre-wrap">
                    {step.stopDiagnostic ?? step.errorMessage}
                  </p>
                )}
                {step.serverUrl && (
                  <a
                    href={step.serverUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-0.5 text-[10px] font-mono text-primary hover:underline"
                  >
                    {step.serverUrl}
                  </a>
                )}
              </div>

              {/* Skip toggle (only when pending) */}
              {isPending && step.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => toggleSkip(step.id)}
                  title={isSkipped ? 'Include' : 'Skip'}
                  className={`p-0.5 rounded shrink-0 transition-colors ${
                    isSkipped
                      ? 'text-success hover:bg-success/10'
                      : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                  }`}
                >
                  {isSkipped ? <CheckCircle2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar during execution */}
      {isExecuting && (
        <div className="px-3 py-1.5 border-t border-border/30">
          <div className="h-1 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${total > 0 ? (doneCount / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
