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
