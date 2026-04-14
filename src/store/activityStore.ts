/**
 * Persists day-by-day token totals for Orchestrator vs Coder runs (agent loop + chat/plan as orchestrator).
 * Used in Settings → Activities for usage charts and rough “cloud savings” estimates.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActivityDayKey = string; // YYYY-MM-DD (local)

export interface DayTokenTotals {
  orchestrator: number;
  coder: number;
}

export interface ActivityState {
  /** Per calendar day (local), total tokens (input + output) by role */
  byDay: Record<ActivityDayKey, DayTokenTotals>;
  recordTokens: (role: 'orchestrator' | 'coder', inputTokens: number, outputTokens: number) => void;
  /** Drop days older than `cutoff` (for manual cleanup / future pruning) */
  clearDaysBefore: (yymmdd: ActivityDayKey) => void;
  resetAll: () => void;
}

const MAX_RETAINED_DAYS = 400;

function todayKey(): ActivityDayKey {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pruneOldDays(byDay: Record<ActivityDayKey, DayTokenTotals>): Record<ActivityDayKey, DayTokenTotals> {
  const keys = Object.keys(byDay).sort();
  if (keys.length <= MAX_RETAINED_DAYS) return byDay;
  const drop = keys.length - MAX_RETAINED_DAYS;
  const next = { ...byDay };
  for (let i = 0; i < drop; i++) delete next[keys[i]!];
  return next;
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      byDay: {},

      recordTokens: (role, inputTokens, outputTokens) => {
        const add = Math.max(0, Math.floor(inputTokens)) + Math.max(0, Math.floor(outputTokens));
        if (add <= 0) return;
        const key = todayKey();
        set((s) => {
          const prev = s.byDay[key] ?? { orchestrator: 0, coder: 0 };
          const row = { ...prev, [role]: prev[role] + add };
          const byDay = pruneOldDays({ ...s.byDay, [key]: row });
          return { byDay };
        });
      },

      clearDaysBefore: (yymmdd) => {
        set((s) => {
          const byDay = { ...s.byDay };
          for (const k of Object.keys(byDay)) {
            if (k < yymmdd) delete byDay[k];
          }
          return { byDay };
        });
      },

      resetAll: () => set({ byDay: {} }),
    }),
    { name: 'code-scout-activity' },
  ),
);

/** Last `n` calendar days ending today, with 0-filled missing days (oldest → newest). */
export function getTokenSeriesLastNDays(
  n: number,
  byDay: Record<ActivityDayKey, DayTokenTotals> = useActivityStore.getState().byDay,
): Array<{
  date: ActivityDayKey;
  label: string;
  orchestrator: number;
  coder: number;
  total: number;
}> {
  const out: Array<{
    date: ActivityDayKey;
    label: string;
    orchestrator: number;
    coder: number;
    total: number;
  }> = [];
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}` as ActivityDayKey;
    const row = byDay[key] ?? { orchestrator: 0, coder: 0 };
    const orch = row.orchestrator;
    const cod = row.coder;
    out.push({
      date: key,
      label: `${m}/${day}`,
      orchestrator: orch,
      coder: cod,
      total: orch + cod,
    });
  }
  return out;
}
