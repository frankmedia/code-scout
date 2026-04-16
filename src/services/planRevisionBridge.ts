/**
 * Lets ChatPlanCard / Plan tab request a plan rework without prop-drilling through the tree.
 * AIPanel registers the handler when mounted.
 */
type PlanRevisionHandler = (feedback: string) => Promise<void>;

let registered: PlanRevisionHandler | null = null;

export function registerPlanRevisionHandler(fn: PlanRevisionHandler | null): void {
  registered = fn;
}

export function getPlanRevisionHandler(): PlanRevisionHandler | null {
  return registered;
}

export async function submitPlanRevision(feedback: string): Promise<void> {
  const fn = registered;
  if (!fn) {
    console.warn('[planRevision] No handler registered (AIPanel not mounted?)');
    return;
  }
  await fn(feedback);
}

// ─── Plan completion evaluation bridge ──────────────────────────────────────
// After all plan steps complete, ChatPlanCard calls this to send step results
// back to the orchestrator model so it can decide whether follow-up work is
// needed (another plan) or the task is done.

type PlanCompletionHandler = (stepResults: string, originalGoal: string) => Promise<void>;

let completionHandler: PlanCompletionHandler | null = null;

export function registerPlanCompletionHandler(fn: PlanCompletionHandler | null): void {
  completionHandler = fn;
}

export async function submitPlanCompletion(stepResults: string, originalGoal: string): Promise<void> {
  const fn = completionHandler;
  const msg = `[LOOP] submitPlanCompletion called | handler: ${!!fn}`;
  console.log(msg);
  try { (await import('@/store/workbenchStore')).useWorkbenchStore.getState().addLog(msg, 'info'); } catch {}
  if (!fn) {
    const warn = '[LOOP] No completion handler registered — AIPanel not mounted?';
    console.warn(warn);
    try { (await import('@/store/workbenchStore')).useWorkbenchStore.getState().addLog(warn, 'warning'); } catch {}
    return;
  }
  await fn(stepResults, originalGoal);
}
