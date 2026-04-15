import { useState } from 'react';
import {
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  Play,
  X,
  Check,
  Undo2,
  Ban,
  ListOrdered,
  Wrench,
  Pencil,
} from 'lucide-react';
import { useWorkbenchStore, PlanStep } from '@/store/workbenchStore';
import { useModelStore } from '@/store/modelStore';
import { orchestrator } from '@/services/orchestrator';
import { submitPlanRevision } from '@/services/planRevisionBridge';

const DESTRUCTIVE_ACTIONS = new Set(['delete_file']);
const SHELL_ACTIONS = new Set(['run_command']);

function StepStatusIcon({ status }: { status: PlanStep['status'] }) {
  switch (status) {
    case 'pending':
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    case 'repairing':
      return <Wrench className="h-3.5 w-3.5 text-warning animate-pulse" />;
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  }
}

/** Full-height plan view for the center “Plan” tab — Execute at top, steps scroll below. */
const PlanTabPanel = () => {
  const {
    currentPlan,
    updatePlanStatus,
    updateStepStatus,
    updateStepLiveOutput,
    updateStepServerUrl,
    addLog,
    addMessage,
    fileHistory,
    rollbackAll,
    setMode,
  } = useWorkbenchStore();

  const getModelForRole = useModelStore(s => s.getModelForRole);
  const [skippedSteps, setSkippedSteps] = useState<Set<string>>(new Set());
  const [showRevise, setShowRevise] = useState(false);
  const [reviseText, setReviseText] = useState('');
  const [reviseBusy, setReviseBusy] = useState(false);

  if (!currentPlan) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground p-6">
        No active plan. Switch to <span className="font-medium text-foreground mx-1">Plan</span> mode in Chat and describe what to build.
      </div>
    );
  }

  const isPending = currentPlan.status === 'pending';
  const isExecuting = currentPlan.status === 'executing';
  const isDone = currentPlan.status === 'done';
  const isRejected = currentPlan.status === 'rejected';
  const hasHistory = fileHistory.length > 0;

  const doneCount = currentPlan.steps.filter(s => s.status === 'done').length;
  const errorCount = currentPlan.steps.filter(s => s.status === 'error').length;
  const total = currentPlan.steps.length;

  const toggleSkip = (stepId: string) => {
    setSkippedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  const handleExecute = async () => {
    setMode('agent');
    updatePlanStatus('executing');

    for (const stepId of skippedSteps) {
      updateStepStatus(stepId, 'done');
    }

    const stepsToRun = currentPlan.steps.filter(s => !skippedSteps.has(s.id));
    const skippedCount = skippedSteps.size;

    addLog('Plan approved — executing...', 'success');
    addMessage({
      role: 'assistant',
      agent: 'coder',
      content: `Plan approved! Executing ${stepsToRun.length} step${stepsToRun.length !== 1 ? 's' : ''}...${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}`,
    });

    const coderModel = getModelForRole('coder');

    await orchestrator.executePlan(
      currentPlan,
      skippedSteps,
      {
        onStepStart: step => updateStepStatus(step.id, 'running'),
        onStepDone: step => updateStepStatus(step.id, 'done'),
        onStepError: (step, _idx, err) => updateStepStatus(step.id, 'error', err),
        onStepOutput: (step, line) => updateStepLiveOutput(step.id, line),
        onStepServerUrl: (step, url) => updateStepServerUrl(step.id, url),
        onRepairStart: step => updateStepStatus(step.id, 'repairing'),
        onComplete: () => {
          updatePlanStatus('done');
          const planState = useWorkbenchStore.getState().currentPlan;
          const failed = planState?.steps.filter(s => s.status === 'error').length ?? 0;
          const serverSteps = planState?.steps.filter(s => s.serverUrl) ?? [];
          const urlList = serverSteps.map(s => `**${s.serverUrl}**`).join(' · ');
          let content: string;
          if (failed > 0) {
            content = `Plan run finished with **${failed} failed step(s)**. Check the Plan tab for details and the Terminal / Logs for command output. Successful edits are in the file tree — use **Rollback** if you want to undo everything.`;
          } else if (urlList) {
            content = `All steps completed! 🚀 Your app is running at ${urlList}. Open that URL in your browser to see it live. Use **Rollback** if you need to undo changes.`;
          } else {
            content = 'All steps completed! Review the changes in the editor. You can **Rollback** all changes if needed.';
          }
          addMessage({ role: 'assistant', agent: 'coder', content });
        },
        onPlanStoppedEarly: (reason) => {
          updatePlanStatus('done');
          addMessage({
            role: 'assistant',
            agent: 'coder',
            content:
              `**Plan stopped** — validation or repair did not succeed. The project may be in a broken state; fix the issue below or use **Rollback**.\n\n${reason.slice(0, 3500)}`,
          });
        },
        onLog: (message, type) => addLog(message, type),
      },
      coderModel,
    );
  };

  const handleReject = () => {
    updatePlanStatus('rejected');
    setSkippedSteps(new Set());
    setShowRevise(false);
    setReviseText('');
    addLog('Plan rejected by user', 'warning');
    addMessage({
      role: 'assistant',
      agent: 'orchestrator',
      content: "Plan rejected. No files were modified. Tell me what you'd like to change.",
    });
  };

  const handleRegeneratePlan = async () => {
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
  };

  const handleRollback = () => {
    rollbackAll();
    addLog('All changes rolled back', 'warning');
    addMessage({
      role: 'assistant',
      agent: 'coder',
      content: 'All file changes have been rolled back to their original state.',
    });
  };

  if (isRejected) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground text-[12px]">
        <p>This plan was rejected.</p>
        <p className="text-xs">Return to Chat to request a new plan.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-surface-panel">
      <div className="shrink-0 border-b border-border px-4 py-3 space-y-3 bg-card/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ListOrdered className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[12px] font-semibold text-foreground leading-tight">{currentPlan.summary}</h2>
              <p className="text-[11px] text-muted-foreground mt-1">
                {total} steps
                {isPending && skippedSteps.size > 0 && ` · ${skippedSteps.size} skipped`}
                {isExecuting && ` · running ${doneCount + 1}/${total}`}
                {isDone && (errorCount > 0 ? ` · finished with ${errorCount} failed` : ' · complete')}
              </p>
              {(currentPlan.validationCommand || isExecuting) && (
                <p className="text-[10px] font-mono text-muted-foreground/80 mt-1">
                  Validate: {currentPlan.validationCommand?.trim() || '(auto-detect)'}
                </p>
              )}
            </div>
          </div>

          {isPending && (
            <div className="flex flex-col items-end gap-2 shrink-0 max-w-full">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleExecute}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors shadow-sm"
                >
                  <Play className="h-4 w-4" />
                  Execute
                </button>
                <button
                  type="button"
                  onClick={() => setShowRevise(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-foreground text-[12px] font-medium hover:bg-surface-hover transition-colors"
                >
                  <Pencil className="h-4 w-4" />
                  Modify
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-destructive/15 text-destructive text-[12px] font-medium hover:bg-destructive/25 transition-colors"
                >
                  <X className="h-4 w-4" />
                  Reject
                </button>
              </div>
              {showRevise && (
                <div className="w-full max-w-md flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3">
                  <label className="text-[11px] text-muted-foreground" htmlFor="plan-revise-tab">
                    What should change?
                  </label>
                  <textarea
                    id="plan-revise-tab"
                    value={reviseText}
                    onChange={e => setReviseText(e.target.value)}
                    rows={4}
                    placeholder="Describe what you do not like or what to add/remove…"
                    className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/70"
                    disabled={reviseBusy}
                  />
                  <button
                    type="button"
                    onClick={() => void handleRegeneratePlan()}
                    disabled={reviseBusy || !reviseText.trim()}
                    className="inline-flex items-center justify-center gap-1.5 self-end px-3 py-2 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-50"
                  >
                    {reviseBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                    Regenerate plan
                  </button>
                </div>
              )}
            </div>
          )}

          {isDone && (
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[12px] flex items-center gap-1.5 ${
                  errorCount > 0 ? 'text-warning' : 'text-success'
                }`}
              >
                <Check className="h-4 w-4" />
                {errorCount > 0 ? `Finished (${errorCount} failed)` : 'Complete'}
              </span>
              {hasHistory && (
                <button
                  type="button"
                  onClick={handleRollback}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-warning/15 text-warning text-[12px] font-medium hover:bg-warning/25 transition-colors"
                >
                  <Undo2 className="h-4 w-4" />
                  Rollback
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-2">
        {currentPlan.steps.map(step => {
          const isSkipped = skippedSteps.has(step.id);
          const isDestructive = DESTRUCTIVE_ACTIONS.has(step.action);
          const isShell = SHELL_ACTIONS.has(step.action);
          return (
            <div
              key={step.id}
              className={`flex items-start gap-3 px-4 py-2.5 border-b border-border/40 transition-colors ${
                step.status === 'running' ? 'bg-primary/5' : ''
              } ${step.status === 'repairing' ? 'bg-warning/10' : ''} ${isSkipped ? 'opacity-40' : ''}`}
            >
              <div className="mt-0.5 shrink-0">
                {isSkipped && isPending ? (
                  <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <StepStatusIcon status={step.status} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[12px] text-foreground ${isSkipped ? 'line-through text-muted-foreground' : ''}`}
                  >
                    {step.description}
                  </span>
                  {isDestructive && !isSkipped && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive font-medium shrink-0">
                      destructive
                    </span>
                  )}
                  {isShell && !isSkipped && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium shrink-0">
                      shell
                    </span>
                  )}
                  {step.path && (
                    <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[200px]">
                      {step.path}
                    </span>
                  )}
                  {step.repairAttemptCount != null && step.repairAttemptCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning font-medium shrink-0">
                      repairing… attempt {step.repairAttemptCount}
                    </span>
                  )}
                </div>
                {step.status === 'repairing' && step.lastValidationError && (
                  <p className="text-[10px] text-warning mt-1 font-mono leading-snug break-words">
                    Repairing… {step.lastValidationCommand ? `(${step.lastValidationCommand}) ` : ''}
                    {step.lastValidationError.slice(0, 400)}
                  </p>
                )}
                {step.status === 'error' && (step.stopDiagnostic || step.errorMessage) && (
                  <div className="mt-1.5 space-y-1">
                    {step.stopDiagnosticKind && (
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        step.stopDiagnosticKind === 'infra'
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-warning/15 text-warning'
                      }`}>
                        {step.stopDiagnosticKind === 'infra'
                          ? 'Infrastructure error'
                          : step.stopDiagnosticKind === 'stuck'
                            ? 'Model stuck — repeated error'
                            : 'Model-caused build failure'}
                      </span>
                    )}
                    <p className={`text-[11px] mt-0.5 leading-snug whitespace-pre-wrap break-words ${
                      step.stopDiagnosticKind === 'infra'
                        ? 'text-destructive/95'
                        : 'text-warning/90'
                    }`}>
                      {step.stopDiagnostic ?? step.errorMessage}
                    </p>
                  </div>
                )}
                {step.serverUrl && (
                  <a
                    href={step.serverUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-mono text-primary hover:underline"
                    title="Open in browser"
                  >
                    🌐 {step.serverUrl}
                  </a>
                )}
                {step.action === 'run_command' && step.status === 'running' && step.liveOutput && !step.serverUrl && (
                  <p className="mt-1 text-[10px] font-mono text-muted-foreground/60 truncate max-w-full leading-tight">
                    {step.liveOutput}
                  </p>
                )}
              </div>
              {isPending && step.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => toggleSkip(step.id)}
                  title={isSkipped ? 'Include this step' : 'Skip this step'}
                  className={`p-1 rounded shrink-0 transition-colors ${
                    isSkipped
                      ? 'text-success hover:bg-success/10'
                      : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                  }`}
                >
                  {isSkipped ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          );
        })}

        {isExecuting && (
          <div className="px-4 py-3 sticky bottom-0 bg-surface-panel/95 border-t border-border">
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${total > 0 ? (doneCount / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanTabPanel;
