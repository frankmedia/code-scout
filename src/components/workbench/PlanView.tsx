import { CheckCircle2, Circle, FilePlus, FilePen, Terminal, Trash2, Loader2, XCircle, Play, X, Eye } from 'lucide-react';
import { useWorkbenchStore, PlanStep } from '@/store/workbenchStore';
import { useState } from 'react';

const stepIcons: Record<string, React.ReactNode> = {
  create_file: <FilePlus className="h-4 w-4" />,
  edit_file: <FilePen className="h-4 w-4" />,
  delete_file: <Trash2 className="h-4 w-4" />,
  run_command: <Terminal className="h-4 w-4" />,
};

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Circle className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
  done: <CheckCircle2 className="h-4 w-4 text-success" />,
  error: <XCircle className="h-4 w-4 text-destructive" />,
};

const DiffModal = ({ step, onClose }: { step: PlanStep; onClose: () => void }) => {
  if (!step.diff) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
      <div className="bg-card border border-border rounded-xl w-[600px] max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">Diff: {step.path}</span>
          <button onClick={onClose} className="p-1 hover:bg-surface-hover rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-destructive font-semibold mb-1">Before</p>
            <pre className="text-xs font-mono bg-destructive/10 p-3 rounded-lg whitespace-pre-wrap">{step.diff.before}</pre>
          </div>
          <div>
            <p className="text-xs text-success font-semibold mb-1">After</p>
            <pre className="text-xs font-mono bg-success/10 p-3 rounded-lg whitespace-pre-wrap">{step.diff.after}</pre>
          </div>
        </div>
      </div>
    </div>
  );
};

const PlanView = () => {
  const { currentPlan, updatePlanStatus, updateStepStatus, addLog, addMessage, setAIPanel, addTerminalOutput } = useWorkbenchStore();
  const [diffStep, setDiffStep] = useState<PlanStep | null>(null);

  if (!currentPlan) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-6">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">No active plan</p>
          <p className="text-xs">Send a message in Chat to generate a plan</p>
        </div>
      </div>
    );
  }

  const handleApprove = async () => {
    updatePlanStatus('executing');
    addLog('Plan approved — executing...', 'success');
    addMessage({ role: 'assistant', content: '✅ Plan approved! Executing steps...' });

    for (const step of currentPlan.steps) {
      updateStepStatus(step.id, 'running');
      addLog(`Running: ${step.description}`, 'info');
      if (step.command) addTerminalOutput(`$ ${step.command}`);
      await new Promise(r => setTimeout(r, 1200));
      updateStepStatus(step.id, 'done');
      addLog(`Completed: ${step.description}`, 'success');
      if (step.command) addTerminalOutput('✓ Done');
    }

    updatePlanStatus('done');
    addLog('All steps completed', 'success');
    addMessage({ role: 'assistant', content: '🎉 All steps completed successfully! Review the changes in the editor.' });
    setAIPanel('chat');
  };

  const handleReject = () => {
    updatePlanStatus('rejected');
    addLog('Plan rejected by user', 'warning');
    addMessage({ role: 'assistant', content: 'Plan rejected. No files were modified. Tell me what you\'d like to change.' });
    setAIPanel('chat');
  };

  const isPending = currentPlan.status === 'pending';
  const isExecuting = currentPlan.status === 'executing';

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <div className="bg-card rounded-lg p-3 border border-border">
        <p className="text-sm font-semibold text-foreground">{currentPlan.summary}</p>
        <p className="text-xs text-muted-foreground mt-1">{currentPlan.steps.length} steps • {currentPlan.status}</p>
      </div>

      <div className="space-y-2">
        {currentPlan.steps.map((step, i) => (
          <div key={step.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
            step.status === 'running' ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'
          }`}>
            <div className="mt-0.5">{statusIcons[step.status]}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{stepIcons[step.action]}</span>
                <span className="text-xs font-mono text-primary">{step.path || step.command}</span>
              </div>
              <p className="text-sm text-foreground mt-1">{step.description}</p>
            </div>
            {step.diff && (
              <button onClick={() => setDiffStep(step)} className="text-xs text-info hover:underline flex items-center gap-1 shrink-0">
                <Eye className="h-3 w-3" /> Diff
              </button>
            )}
          </div>
        ))}
      </div>

      {isPending && (
        <div className="flex gap-2 pt-2">
          <button onClick={handleApprove} className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2 rounded-lg text-sm font-medium hover:bg-primary/80 transition-colors">
            <Play className="h-4 w-4" /> Approve & Execute
          </button>
          <button onClick={handleReject} className="flex-1 flex items-center justify-center gap-2 bg-destructive/15 text-destructive py-2 rounded-lg text-sm font-medium hover:bg-destructive/25 transition-colors">
            <X className="h-4 w-4" /> Reject
          </button>
        </div>
      )}

      {isExecuting && (
        <div className="text-center py-2">
          <p className="text-sm text-primary animate-step-pulse">Executing plan...</p>
        </div>
      )}

      {diffStep && <DiffModal step={diffStep} onClose={() => setDiffStep(null)} />}
    </div>
  );
};

export default PlanView;
