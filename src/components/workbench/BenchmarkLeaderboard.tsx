import { useState, useEffect } from 'react';
import type { FC } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  Trophy,
  ChevronDown,
  ChevronUp,
  Star,
  AlertTriangle,
  Zap,
  Code2,
  Bug,
  FileText,
  Wrench,
  Cpu,
  TrendingUp,
  TrendingDown,
  Minus,
  XCircle,
  Brain,
  CheckCircle2,
  XOctagon,
} from 'lucide-react';
import { recommendModel } from '@/services/benchmarkScorer';
import type { BenchmarkRun, ModelBenchmarkScore, ScoreCategory, FunctionalResult } from '@/types/benchmark';
import { useModelStore } from '@/store/modelStore';
import { getOllamaInstalledModelNames } from '@/services/modelApi';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ScoreCategory, string> = {
  'code-gen': 'Gen',
  'code-edit': 'Edit',
  'debug': 'Debug',
  'reasoning': 'Reasoning',
  'context': 'Context',
  'tool-use': 'Tools',
  'speed': 'Speed',
  'cost': 'Cost',
};

const RADAR_CATEGORIES: ScoreCategory[] = [
  'code-gen', 'code-edit', 'debug', 'reasoning', 'context', 'tool-use', 'speed',
];

function scoreColor(score: number): string {
  if (score >= 70) return 'text-success';
  if (score >= 40) return 'text-warning';
  return 'text-destructive';
}

function scoreBarColor(score: number): string {
  if (score >= 70) return 'bg-success';
  if (score >= 40) return 'bg-warning';
  return 'bg-destructive';
}

const RANK_ICONS = ['🥇', '🥈', '🥉'];

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ label, raw, skipped }: { label: string; raw: number; skipped?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        {!skipped && (
          <div
            className={`h-full rounded-full transition-all ${scoreBarColor(raw * 10)}`}
            style={{ width: `${Math.min(100, raw * 10)}%` }}
          />
        )}
      </div>
      <span className="text-[10px] tabular-nums w-8 text-right text-muted-foreground">
        {skipped ? 'N/A' : raw.toFixed(1)}
      </span>
    </div>
  );
}

// ─── Radar chart for a single model ─────────────────────────────────────────

function ModelRadar({ score }: { score: ModelBenchmarkScore }) {
  const data = RADAR_CATEGORIES.map(cat => ({
    subject: CATEGORY_LABELS[cat],
    // Skipped categories render as 0 on the radar so the polygon isn't distorted
    value: score.categories[cat]?.skipped ? 0 : (score.categories[cat]?.raw ?? 0),
    fullMark: 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <RadarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
        <PolarGrid stroke="currentColor" className="text-border opacity-40" />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: 9, fill: 'currentColor' }}
          className="text-muted-foreground"
        />
        <Radar
          name={score.modelName}
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="hsl(var(--primary))"
          fillOpacity={0.2}
        />
        <Tooltip
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            fontSize: 11,
          }}
          formatter={(v: number) => [v.toFixed(1) + ' / 10', score.modelName]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ─── Score delta badge ────────────────────────────────────────────────────────

function DeltaBadge({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.5) {
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  }
  if (delta > 0) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-success font-medium">
        <TrendingUp className="h-3 w-3" />+{delta.toFixed(0)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-destructive font-medium">
      <TrendingDown className="h-3 w-3" />{delta.toFixed(0)}
    </span>
  );
}

// ─── Functional test details ─────────────────────────────────────────────────

function FunctionalTestDetails({ results }: { results: FunctionalResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface-panel rounded p-2 space-y-1">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="text-[10px] font-medium text-muted-foreground flex-1">
          Functional Tests: {results.passed}/{results.total} passed
        </span>
        <span className={`text-[10px] font-bold tabular-nums ${
          results.passed === results.total ? 'text-success' :
          results.passed > 0 ? 'text-warning' : 'text-destructive'
        }`}>
          {Math.round((results.passed / results.total) * 100)}%
        </span>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-muted-foreground" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="space-y-0.5 pt-1">
          {results.details.map((d, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px]">
              {d.passed
                ? <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-px" />
                : <XOctagon className="h-3 w-3 text-destructive shrink-0 mt-px" />}
              <div className="min-w-0 flex-1">
                <span className={d.passed ? 'text-muted-foreground' : 'text-foreground'}>
                  {d.description}
                </span>
                {!d.passed && d.error && (
                  <p className="text-destructive font-mono mt-0.5 truncate">{d.error}</p>
                )}
                {!d.passed && d.actual != null && d.expected != null && (
                  <p className="text-muted-foreground font-mono mt-0.5">
                    got <span className="text-destructive">{d.actual}</span>
                    {' '}want <span className="text-success">{d.expected}</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Expandable model card ────────────────────────────────────────────────────

function ModelCard({
  score,
  rank,
  prevScore,
  run,
}: {
  score: ModelBenchmarkScore;
  rank: number;
  prevScore?: ModelBenchmarkScore;
  run: BenchmarkRun;
}) {
  const [expanded, setExpanded] = useState(rank === 0);
  const delta = prevScore != null ? score.totalScore - prevScore.totalScore : null;

  const modelResults = run.results.filter(r => r.modelId === score.modelConfigId);
  const functionalResults = modelResults.filter(r => r.functionalResults && r.functionalResults.total > 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-hover transition-colors text-left"
      >
        <span className="text-base w-5 shrink-0">{RANK_ICONS[rank] ?? `#${rank + 1}`}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{score.modelName}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-muted-foreground">{score.provider}</span>
            {score.passAt1 > 0 && (
              <span className={`text-[10px] font-medium ${
                score.passAt1 >= 0.8 ? 'text-success' :
                score.passAt1 >= 0.5 ? 'text-warning' : 'text-destructive'
              }`}>
                pass@1: {Math.round(score.passAt1 * 100)}%
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {delta !== null && <DeltaBadge delta={delta} />}
          <span className={`text-lg font-bold tabular-nums ${scoreColor(score.totalScore)}`}>
            {score.totalScore}
          </span>
          <span className="text-[10px] text-muted-foreground">/ 100</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border bg-card/50 px-3 py-3 space-y-4">
          {/* Radar + bars */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 min-w-0">
              <ModelRadar score={score} />
            </div>
            <div className="flex-1 min-w-0 space-y-1.5 pt-1">
              {RADAR_CATEGORIES.map(cat => (
                <ScoreBar
                  key={cat}
                  label={CATEGORY_LABELS[cat]}
                  raw={score.categories[cat]?.raw ?? 0}
                  skipped={score.categories[cat]?.skipped}
                />
              ))}
              <ScoreBar label="Cost" raw={score.categories['cost']?.raw ?? 0} />
            </div>
          </div>

          {/* Functional test results */}
          {functionalResults.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-2.5 w-2.5" /> Functional Correctness (pass@1)
              </p>
              {functionalResults.map(r => (
                <FunctionalTestDetails key={r.testId} results={r.functionalResults!} />
              ))}
            </div>
          )}

          {/* Performance metrics */}
          <div className="grid grid-cols-3 gap-2">
            {(() => {
              const doneResults = modelResults.filter(r => r.status === 'done');
              const avgTtft = doneResults.length > 0
                ? doneResults.reduce((s, r) => s + r.ttft, 0) / doneResults.length
                : 0;
              const avgTps = doneResults.length > 0
                ? doneResults.reduce((s, r) => s + r.tokensPerSecond, 0) / doneResults.length
                : 0;
              const totalTokens = doneResults.reduce((s, r) => s + r.outputTokens, 0);
              return [
                { label: 'Avg TTFT', value: `${(avgTtft / 1000).toFixed(2)}s` },
                { label: 'Avg tok/s', value: avgTps.toFixed(1) },
                { label: 'Total tokens', value: totalTokens.toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="bg-surface-panel rounded p-2 text-center">
                  <p className="text-xs font-bold tabular-nums">{value}</p>
                  <p className="text-[9px] text-muted-foreground">{label}</p>
                </div>
              ));
            })()}
          </div>

          {/* Strengths / Weaknesses */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-medium text-success flex items-center gap-1 mb-1">
                <Star className="h-2.5 w-2.5" /> Strengths
              </p>
              <ul className="space-y-0.5">
                {score.strengths.map((s, i) => (
                  <li key={i} className="text-[10px] text-muted-foreground flex gap-1">
                    <span className="text-success shrink-0">+</span> {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-medium text-warning flex items-center gap-1 mb-1">
                <AlertTriangle className="h-2.5 w-2.5" /> Weaknesses
              </p>
              <ul className="space-y-0.5">
                {score.weaknesses.map((w, i) => (
                  <li key={i} className="text-[10px] text-muted-foreground flex gap-1">
                    <span className="text-warning shrink-0">−</span> {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Best for */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-1">Best for</p>
            <div className="flex flex-wrap gap-1">
              {score.bestFor.map((label, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/50">
            Scored at {new Date(score.runAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Recommendation row ───────────────────────────────────────────────────────

type TaskType = 'coding' | 'refactoring' | 'debugging' | 'reasoning' | 'research';

const TASK_META: { id: TaskType; label: string; Icon: FC<{ className?: string }> }[] = [
  { id: 'coding',      label: 'Coding',      Icon: Code2 },
  { id: 'refactoring', label: 'Refactoring', Icon: Wrench },
  { id: 'debugging',   label: 'Debugging',   Icon: Bug },
  { id: 'reasoning',   label: 'Reasoning',   Icon: Brain },
  { id: 'research',    label: 'Research',    Icon: FileText },
];

function RecommendationRow({
  leaderboard,
}: {
  leaderboard: ModelBenchmarkScore[];
}) {
  return (
    <div className="border border-border rounded-lg p-3">
      <p className="text-xs font-semibold flex items-center gap-1.5 mb-3">
        <Zap className="h-3.5 w-3.5 text-primary" />
        Recommended by Task
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {TASK_META.map(({ id, label, Icon }) => {
          const pick = recommendModel(id, leaderboard);
          return (
            <div key={id} className="bg-surface-panel rounded p-2 space-y-1">
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Icon className="h-3 w-3" /> {label}
              </p>
              {pick ? (
                <>
                  <p className="text-xs font-medium truncate">{pick.modelName}</p>
                  <p className="text-[10px] text-muted-foreground">{pick.provider}</p>
                </>
              ) : (
                <p className="text-[10px] text-muted-foreground">—</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Error details banner ─────────────────────────────────────────────────────

function ErrorBanner({ run }: { run: BenchmarkRun }) {
  const [expanded, setExpanded] = useState(true);
  const [tagFetch, setTagFetch] = useState<{
    status: 'idle' | 'loading' | 'done' | 'failed';
    models: string[];
    triedUrls: string[];
    successUrl?: string;
  }>({ status: 'idle', models: [], triedUrls: [] });

  const models = useModelStore(s => s.models);
  const resolve = useModelStore(s => s.resolveModelRequestFields);

  const errorResults = run.results.filter(r => r.status === 'error');
  if (errorResults.length === 0) return null;

  const has404 = errorResults.some(r => r.error?.includes('404'));

  function baseUrlForModel(configId: string, fromResult?: string): string {
    if (fromResult?.trim()) return fromResult.replace(/\/+$/, '');
    const m = models.find(x => x.id === configId);
    if (!m) return '';
    const ep = resolve(m).endpoint?.replace(/\/+$/, '') ?? '';
    return ep;
  }

  const byModel = new Map<
    string,
    {
      name: string;
      configuredId: string;
      actualId: string;
      baseUrl: string;
      provider: string;
      tests: string[];
      error: string;
    }
  >();
  for (const r of errorResults) {
    const m = models.find(x => x.id === r.modelId);
    const baseUrl = baseUrlForModel(r.modelId, r.requestBaseUrl);
    const actualId = r.actualModelId ?? r.modelId;
    const configuredId = r.configuredModelId ?? actualId;
    if (!byModel.has(r.modelId)) {
      byModel.set(r.modelId, {
        name: r.modelName ?? r.modelId,
        configuredId,
        actualId,
        baseUrl,
        provider: m?.provider ?? 'ollama',
        tests: [],
        error: r.error ?? 'Unknown error',
      });
    }
    byModel.get(r.modelId)!.tests.push(r.testId);
  }

  const ollamaBases = [
    ...new Set(
      [...byModel.values()]
        .filter(i => i.provider === 'ollama' && i.baseUrl)
        .map(i => i.baseUrl),
    ),
  ];

  const ollamaBasesKey = ollamaBases.join('|');

  useEffect(() => {
    setTagFetch({ status: 'idle', models: [], triedUrls: [] });
  }, [run.id]);

  useEffect(() => {
    if (!has404 || ollamaBases.length === 0) return;
    const ac = new AbortController();
    setTagFetch({ status: 'loading', models: [], triedUrls: ollamaBases });

    (async () => {
      for (const base of ollamaBases) {
        const names = await getOllamaInstalledModelNames(base, ac.signal);
        if (ac.signal.aborted) return;
        if (names !== null) {
          setTagFetch({
            status: 'done',
            models: names,
            triedUrls: ollamaBases,
            successUrl: base,
          });
          return;
        }
      }
      if (!ac.signal.aborted) {
        setTagFetch({ status: 'failed', models: [], triedUrls: ollamaBases });
      }
    })();

    return () => ac.abort();
  }, [run.id, has404, ollamaBasesKey]);

  return (
    <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3 space-y-2">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-2 text-left"
      >
        <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
        <p className="text-xs font-medium text-destructive flex-1">
          {errorResults.length} test{errorResults.length > 1 ? 's' : ''} failed
        </p>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
          : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />}
      </button>

      {expanded && (
        <div className="space-y-3 pl-2">
          {[...byModel.entries()].map(([, info]) => (
            <div key={info.actualId + info.baseUrl} className="bg-card/60 rounded p-2 space-y-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[10px] font-medium text-foreground">{info.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  Settings: <span className="text-destructive">{info.configuredId}</span>
                  {info.configuredId !== info.actualId && (
                    <span> → ran as <span className="text-warning">{info.actualId}</span></span>
                  )}
                  {info.baseUrl
                    ? <span> @ {info.baseUrl}</span>
                    : <span className="text-warning"> (no endpoint — set in Settings → Discover)</span>}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Failed: {info.tests.join(', ')} — {info.error.replace(/Ollama error: /, '')}
              </p>
            </div>
          ))}

          {has404 && [...byModel.values()].some(i => i.provider === 'ollama') && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Models on server
                {tagFetch.successUrl && (
                  <span className="font-normal text-muted-foreground normal-case"> — {tagFetch.successUrl}</span>
                )}
              </p>
              {tagFetch.status === 'loading' && (
                <p className="text-[10px] text-muted-foreground animate-pulse">
                  Querying {ollamaBases.length ? ollamaBases.join(' · ') : '…'}…
                </p>
              )}
              {tagFetch.status === 'failed' && (
                <p className="text-[10px] text-destructive">
                  Could not reach /api/tags at{' '}
                  {ollamaBases.length > 0 ? ollamaBases.join(' · ') : 'any resolved Ollama URL'}
                </p>
              )}
              {tagFetch.status === 'done' && tagFetch.models.length === 0 && (
                <p className="text-[10px] text-destructive">No models loaded on that server.</p>
              )}
              {tagFetch.status === 'done' && tagFetch.models.length > 0 && (
                <div className="space-y-0.5">
                  {tagFetch.models.map(name => {
                    const sentIds = [
                      ...new Set([...byModel.values()].flatMap(v => [v.configuredId, v.actualId])),
                    ];
                    const isExactMatch = sentIds.includes(name);
                    const isClose =
                      !isExactMatch &&
                      sentIds.some(s => name.split(':')[0] === s.split(':')[0]);
                    return (
                      <p
                        key={name}
                        className={`text-[10px] font-mono flex items-center gap-1.5
                          ${isExactMatch ? 'text-success' : isClose ? 'text-warning' : 'text-muted-foreground'}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 inline-block
                            ${isExactMatch ? 'bg-success' : isClose ? 'bg-warning' : 'bg-border'}`}
                        />
                        {name}
                        {isClose && (
                          <span className="text-[9px] text-warning ml-1">
                            ← close match, update model ID in Settings
                          </span>
                        )}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Summary stats row ────────────────────────────────────────────────────────

function SummaryStats({ run, previousRun }: { run: BenchmarkRun; previousRun?: BenchmarkRun }) {
  const done = run.results.filter(r => r.status === 'done').length;
  const errors = run.results.filter(r => r.status === 'error').length;
  const totalMs = run.results.reduce((s, r) => s + r.totalMs, 0);
  const totalTokens = run.results.reduce((s, r) => s + r.outputTokens, 0);

  const allFunctional = run.results
    .filter(r => r.functionalResults && r.functionalResults.total > 0)
    .map(r => r.functionalResults!);
  const functionalPassed = allFunctional.reduce((s, f) => s + f.passed, 0);
  const functionalTotal = allFunctional.reduce((s, f) => s + f.total, 0);

  const prevDone = previousRun ? previousRun.results.filter(r => r.status === 'done').length : null;
  const prevErrors = previousRun ? previousRun.results.filter(r => r.status === 'error').length : null;

  const stats = [
    {
      label: 'Tests run', value: done + errors,
      delta: prevDone !== null && prevErrors !== null ? (done + errors) - (prevDone + prevErrors) : null,
    },
    { label: 'Passed', value: done, delta: prevDone !== null ? done - prevDone : null },
    { label: 'Errors', value: errors, delta: prevErrors !== null ? errors - prevErrors : null, invert: true },
    {
      label: 'Pass@1',
      value: functionalTotal > 0 ? `${functionalPassed}/${functionalTotal}` : '—',
      delta: null,
    },
    { label: 'Total time', value: `${(totalMs / 1000).toFixed(1)}s`, delta: null },
    { label: 'Tokens out', value: totalTokens.toLocaleString(), delta: null },
  ];

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
      {stats.map(({ label, value, delta, invert }) => (
        <div key={label} className="bg-surface-panel rounded p-2 text-center">
          <p className="text-sm font-bold tabular-nums">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
          {delta !== null && Math.abs(delta) > 0 && (
            <p className={`text-[10px] font-medium tabular-nums ${
              (invert ? delta < 0 : delta > 0) ? 'text-success' : 'text-destructive'
            }`}>
              {delta > 0 ? `+${delta}` : delta} vs prev
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Leaderboard ─────────────────────────────────────────────────────────

interface Props {
  run: BenchmarkRun;
  previousRun?: BenchmarkRun;
}

const BenchmarkLeaderboard = ({ run, previousRun }: Props) => {
  const leaderboard = run.scores;
  const totalCells = run.selectedModelIds.length * run.selectedTestIds.length;
  const finishedCells = run.results.filter(
    r => r.status === 'done' || r.status === 'error' || r.status === 'skipped',
  ).length;

  if (leaderboard.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No results yet — run a benchmark first.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Trophy className="h-3.5 w-3.5 text-warning" />
        <span className="text-xs font-semibold">Leaderboard</span>
        {previousRun && (
          <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            vs {new Date(previousRun.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {run.status === 'running'
            ? `Live · ${finishedCells}/${totalCells} tests`
            : run.status === 'done'
              ? `Completed ${run.finishedAt ? new Date(run.finishedAt).toLocaleString() : ''}`
              : run.status === 'aborted'
                ? 'Aborted'
                : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {run.status === 'running' && (
          <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-[10px] text-muted-foreground">
            <Cpu className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
            <span>
              Run in progress — leaderboard is partial. Scores refresh as each cell completes.
            </span>
          </div>
        )}
        {/* Summary */}
        <SummaryStats run={run} previousRun={previousRun} />

        {/* Error banner */}
        <ErrorBanner run={run} />

        {/* Recommendations */}
        <RecommendationRow leaderboard={leaderboard} />

        {/* Ranked model cards */}
        <div className="space-y-2">
          {leaderboard.map((score, i) => {
            const prevScore = previousRun?.scores.find(s => s.modelConfigId === score.modelConfigId);
            return (
              <ModelCard key={score.modelConfigId} score={score} rank={i} prevScore={prevScore} run={run} />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default BenchmarkLeaderboard;
