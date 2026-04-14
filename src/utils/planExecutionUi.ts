import type { PlanStep } from '@/store/workbenchStore';

/** Human-readable progress while a plan is executing (avoids e.g. "4/3" after all steps are marked done). */
export function planExecutionProgressSuffix(steps: PlanStep[]): string {
  const total = steps.length;
  if (total === 0) return 'starting…';

  const doneCount = steps.filter(s => s.status === 'done').length;
  const activeIdx = steps.findIndex(s => s.status === 'running' || s.status === 'repairing');

  if (activeIdx >= 0) {
    return `running ${activeIdx + 1}/${total}`;
  }
  if (doneCount >= total) {
    return 'finishing…';
  }
  return `running ${Math.min(doneCount + 1, total)}/${total}`;
}
