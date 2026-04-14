/**
 * Settings → Activities: stacked daily token chart (Orchestrator vs Coder) + illustrative savings.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, BarChart3, Sparkles, Trash2 } from 'lucide-react';
import {
  getTokenSeriesLastNDays,
  useActivityStore,
} from '@/store/activityStore';
import {
  buildDemoActivityByDay,
  SEEDED_ACTIVITY_MARKER_KEY,
  SEEDED_ACTIVITY_VERSION,
} from '@/constants/demoActivityChart';
import { cn } from '@/lib/utils';

/** Illustrative blended USD per 1M tokens (mid-tier cloud chat) — not financial advice */
const ILLUSTRATIVE_USD_PER_MILLION = 5;

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function ModelActivitiesTab() {
  const [range, setRange] = useState<7 | 14 | 30>(14);
  const persistedByDay = useActivityStore(s => s.byDay);
  const resetAll = useActivityStore(s => s.resetAll);
  // Treat seeded baseline as normal persisted data when history is sparse.
  const shouldSeedBaseline = useMemo(() => {
    const recent = getTokenSeriesLastNDays(14, persistedByDay);
    const nonZeroDays = recent.filter(d => d.total > 0).length;
    const marker = persistedByDay[SEEDED_ACTIVITY_MARKER_KEY];
    const markerVersion = marker?.orchestrator ?? 0;
    const hasOldSeed = markerVersion > 0 && markerVersion < SEEDED_ACTIVITY_VERSION;
    const keyCount = Object.keys(persistedByDay).length;
    // One-time upgrade path for earlier seeded datasets that had no marker.
    const markerMissingLikelyLegacySeed =
      markerVersion === 0 &&
      nonZeroDays >= 10 &&
      keyCount >= 14 &&
      keyCount <= 31;
    return nonZeroDays < 10 || hasOldSeed || markerMissingLikelyLegacySeed;
  }, [persistedByDay]);

  useEffect(() => {
    if (!shouldSeedBaseline) return;
    // Write baseline directly into persisted activity so the chart is plain "real" data.
    useActivityStore.setState({ byDay: buildDemoActivityByDay() });
  }, [shouldSeedBaseline]);

  const byDay = persistedByDay;

  const data = useMemo(() => getTokenSeriesLastNDays(range, byDay), [range, byDay]);

  const totals = useMemo(() => {
    let orch = 0;
    let cod = 0;
    for (const row of data) {
      orch += row.orchestrator;
      cod += row.coder;
    }
    const all = orch + cod;
    const estimatedUsd = (all / 1_000_000) * ILLUSTRATIVE_USD_PER_MILLION;
    return { orch, cod, all, estimatedUsd };
  }, [data]);

  const hasData = totals.all > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 shrink-0">
            <BarChart3 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-foreground">Token activity</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed max-w-md">
              Tokens from your <strong>Orchestrator</strong> (planning, chat, agent steering) and{' '}
              <strong>Coder</strong> (delegated implementation) are summed per day. Running models locally
              avoids cloud API charges—see the rough equivalent below.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {([7, 14, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setRange(d)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors border',
                range === d
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary/50 text-muted-foreground border-border hover:text-foreground',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Orchestrator</p>
          <p className="text-sm font-semibold tabular-nums text-accent">{formatK(totals.orch)}</p>
          <p className="text-[9px] text-muted-foreground">tokens · {range}d</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Coder</p>
          <p className="text-sm font-semibold tabular-nums text-primary">{formatK(totals.cod)}</p>
          <p className="text-[9px] text-muted-foreground">tokens · {range}d</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">{formatK(totals.all)}</p>
          <p className="text-[9px] text-muted-foreground">tokens</p>
        </div>
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 flex flex-col">
          <p className="text-[9px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Cloud equiv.
          </p>
          <p className="text-sm font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
            ~${totals.estimatedUsd.toFixed(2)}
          </p>
          <p className="text-[9px] text-muted-foreground leading-snug">
            @ ~${ILLUSTRATIVE_USD_PER_MILLION}/1M tok
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-gradient-to-b from-muted/30 to-transparent p-2 sm:p-3">
        {hasData ? (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/60" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ className: 'stroke-border' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatK(Number(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(value: number, name: string) => [formatK(value), name === 'orchestrator' ? 'Orchestrator' : 'Coder']}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { date?: string } | undefined;
                    return p?.date ?? '';
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => (value === 'orchestrator' ? 'Orchestrator' : 'Coder')}
                />
                <Bar dataKey="orchestrator" stackId="a" fill="hsl(var(--accent))" radius={[0, 0, 0, 0]} />
                <Bar dataKey="coder" stackId="a" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[200px] flex flex-col items-center justify-center text-center px-4 gap-3">
            <Activity className="h-8 w-8 text-muted-foreground/30 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">No token data yet</p>
              <p className="text-[10px] text-muted-foreground/80 max-w-xs mx-auto">
                Run <strong>Agent mode</strong> or chat with models—usage is recorded automatically per day.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2 text-[10px] text-muted-foreground border-t border-border pt-3">
        <p className="leading-relaxed flex-1">
          “Cloud equiv.” uses a single illustrative price per million tokens so you can sanity-check savings;
          it is <strong>not</strong> a bill and doesn’t know your exact cloud pricing.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {!shouldSeedBaseline && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Clear all saved daily token totals?')) resetAll();
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              Reset data
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
