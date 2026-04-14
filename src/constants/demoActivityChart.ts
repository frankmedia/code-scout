/**
 * Sample token history for marketing screenshots (Settings → Activities).
 * In-app: toggle “Sample chart (screenshot)” — does not write to persisted storage.
 * Or set VITE_DEMO_ACTIVITY_CHART / VITE_DEMO_ACTIVITY_SCREENSHOT — same series, no merge with real data.
 */
import type { ActivityDayKey, DayTokenTotals } from '@/store/activityStore';

/** Must match ModelActivitiesTab illustrative rate */
const USD_PER_MILLION_TOKENS = 5;
export const SEEDED_ACTIVITY_VERSION = 2;
export const SEEDED_ACTIVITY_MARKER_KEY = '__seed_profile_version__';

function tokensForCloudEquivUsd(usd: number): number {
  return Math.round((usd / USD_PER_MILLION_TOKENS) * 1_000_000);
}

/** Deterministic pseudo-random [0,1) from a string seed (stable across renders). */
function seededUnit(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function splitRoles(totalTokens: number, seed: string): DayTokenTotals {
  // Keep a realistic orchestrator/coder split with slight day-to-day variance.
  const pct = 0.54 + seededUnit(`${seed}:split`) * 0.10; // 54%..64%
  const orchestrator = Math.round(totalTokens * pct);
  return { orchestrator, coder: totalTokens - orchestrator };
}

/**
 * 30 calendar days ending “today”: older days stay low, then the last 10 days
 * rise with slight randomness around ~$3 → ~$7 cloud-equiv/day.
 */
export function buildDemoActivityByDay(): Record<ActivityDayKey, DayTokenTotals> {
  const out: Record<ActivityDayKey, DayTokenTotals> = {};
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

  const n = 30;
  /**
   * Sample $/day profile (oldest → newest):
   * - older 20 days: low non-zero baseline
   * - last 10 days: randomized but upward, ~3 → ~7/day
   */
  const dailyUsd: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    if (i < 20) {
      const base = 1.5 + (i / 19) * 1.4; // ~1.5 → ~2.9
      const jitter = (seededUnit(`${endKey}:lead:${i}`) - 0.5) * 0.55; // +/-0.275
      dailyUsd[i] = clamp(base + jitter, 1.1, 3.0);
    } else {
      const j = i - 20; // 0..9 (last 10 days)
      const rA = seededUnit(`${endKey}:tail:${j}:a`);
      const rB = seededUnit(`${endKey}:tail:${j}:b`);
      const trend = 3 + (j / 9) * 4; // 3 -> 7
      const jitter = (rA - 0.5) * 1.1; // +/-0.55
      let next = trend + jitter;
      if (j > 0) {
        const prev = dailyUsd[i - 1]!;
        // Keep the overall direction up, but allow small random dips.
        next = Math.max(next, prev - (0.12 + rB * 0.16)); // dip up to ~0.28
      }
      if (j === 9) next = 6.7 + rB * 0.35; // end around 6.7..7.05
      dailyUsd[i] = clamp(next, 2.8, 7.2);
    }
  }

  for (let i = 0; i < n; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - (n - 1 - i));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}` as ActivityDayKey;
    let usd = dailyUsd[i]!;
    const weekday = d.getDay(); // 0=Sun .. 6=Sat
    // Weekend softness looks more realistic for activity screenshots.
    if (weekday === 0 || weekday === 6) {
      const weekendFactor = 0.70 + seededUnit(`${key}:weekend`) * 0.12; // 70%..82%
      usd *= weekendFactor;
    }
    // Requested explicit dip around Apr 3/4/5 for the shown timeline.
    if (m === '04' && (day === '03' || day === '04' || day === '05')) {
      const specialFactor = 0.62 + seededUnit(`${key}:apr345`) * 0.10; // 62%..72%
      usd *= specialFactor;
    }
    usd = Math.round(usd * 100) / 100;
    out[key] = splitRoles(tokensForCloudEquivUsd(usd), key);
  }

  // Internal marker so we can update seeded profile shape in future revisions.
  out[SEEDED_ACTIVITY_MARKER_KEY as ActivityDayKey] = {
    orchestrator: SEEDED_ACTIVITY_VERSION,
    coder: 0,
  };

  return out;
}

/** Illustrative data for dev (shows a small banner). */
export const isDemoActivityChartEnabled = (): boolean =>
  import.meta.env.VITE_DEMO_ACTIVITY_CHART === 'true' ||
  import.meta.env.VITE_DEMO_ACTIVITY_SCREENSHOT === 'true';

/** Banner only when using the dev flag — screenshot mode stays visually clean. */
export const showDemoActivityChartBanner = (): boolean =>
  import.meta.env.VITE_DEMO_ACTIVITY_CHART === 'true';
