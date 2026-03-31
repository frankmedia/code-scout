import { useState, Component, useMemo, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  Play,
  Square,
  Trash2,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
  FlaskConical,
  AlertTriangle,
  History,
  ChevronDown,
  Info,
} from 'lucide-react';
import type { BenchmarkRun } from '@/types/benchmark';

// ─── Error Boundary ──────────────────────────────────────────────────────────

class BenchmarkErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium text-destructive">Benchmark panel error</p>
          <pre className="text-[10px] text-muted-foreground bg-muted rounded p-3 max-w-full overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { useBenchmarkStore } from '@/store/benchmarkStore';
import { useModelStore } from '@/store/modelStore';
import { ALL_BENCHMARK_TESTS } from '@/services/benchmarkTests';
import BenchmarkLeaderboard from '@/components/workbench/BenchmarkLeaderboard';
import type { TestRunStatus } from '@/types/benchmark';

// ─── Status cell ─────────────────────────────────────────────────────────────

function StatusCell({ status }: { status: TestRunStatus | undefined }) {
  const wrap = (child: React.ReactNode) => (
    <span className="inline-flex items-center justify-center w-full">{child}</span>
  );
  if (!status || status === 'pending') {
    return wrap(<span className="text-muted-foreground text-[10px]">—</span>);
  }
  if (status === 'running') {
    return wrap(<Loader2 className="h-3 w-3 text-primary animate-spin" />);
  }
  if (status === 'done') {
    return wrap(<CheckCircle2 className="h-3 w-3 text-success" />);
  }
  if (status === 'error') {
    return wrap(<XCircle className="h-3 w-3 text-destructive" />);
  }
  if (status === 'skipped') {
    return wrap(<span className="text-muted-foreground text-[10px]">skip</span>);
  }
  return null;
}

// ─── Model toggle row ─────────────────────────────────────────────────────────

function ModelRow({
  model,
  selected,
  onToggle,
  disabled,
}: {
  model: { id: string; name: string; provider: string; modelId: string };
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-xs
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-hover'}
        ${selected ? 'text-foreground' : 'text-muted-foreground'}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        className="accent-primary h-3 w-3 mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate leading-none">{model.name}</p>
        <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">{model.modelId}</p>
      </div>
      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">{model.provider}</span>
    </label>
  );
}

// ─── Test toggle row with rationale ──────────────────────────────────────────

function TestRow({
  test,
  selected,
  onToggle,
  disabled,
}: {
  test: (typeof ALL_BENCHMARK_TESTS)[number];
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const [showRationale, setShowRationale] = useState(false);
  const hasFunc = test.functionalTests && test.functionalTests.length > 0;

  return (
    <div className={`rounded transition-colors ${disabled ? 'opacity-50' : 'hover:bg-surface-hover'}`}>
      <label className="flex items-start gap-2 px-2 py-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={disabled}
          className="accent-primary h-3 w-3 mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium leading-none">{test.name}</p>
            {hasFunc && (
              <span className="text-[9px] px-1 py-px rounded bg-success/15 text-success font-medium">
                {test.functionalTests!.length} unit tests
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
            {test.description}
          </p>
        </div>
        <button
          onClick={e => { e.preventDefault(); setShowRationale(r => !r); }}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
          title="Why this test?"
        >
          <Info className="h-3 w-3" />
        </button>
      </label>
      {showRationale && (
        <div className="mx-2 mb-2 ml-7 px-2.5 py-2 rounded bg-muted/50 border border-border">
          <p className="text-[10px] text-muted-foreground leading-relaxed italic">
            {test.rationale}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

type TabView = 'setup' | 'results';

// ─── Run history dropdown ────────────────────────────────────────────────────

function RunHistoryDropdown({
  runs,
  selectedIndex,
  onSelect,
}: {
  runs: BenchmarkRun[];
  selectedIndex: number;
  onSelect: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = runs[selectedIndex];
  if (!selected) return null;

  function label(run: BenchmarkRun, i: number) {
    const date = new Date(run.startedAt);
    const errors = run.results.filter(r => r.status === 'error').length;
    const done = run.results.filter(r => r.status === 'done').length;
    const timeStr = date.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const statusBadge = run.status === 'aborted' ? '⚠ aborted' : errors > 0 ? `${errors} err` : `${done} ok`;
    return { timeStr, statusBadge, isLatest: i === 0 };
  }

  const { timeStr, statusBadge, isLatest } = label(selected, selectedIndex);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 transition-colors"
      >
        <History className="h-3 w-3" />
        <span>{isLatest ? 'Latest' : timeStr}</span>
        <span className={`text-[10px] ${selected.results.filter(r => r.status === 'error').length > 0 ? 'text-destructive' : 'text-success'}`}>
          {statusBadge}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg overflow-hidden min-w-[220px]">
          {runs.map((run, i) => {
            const { timeStr: t, statusBadge: s, isLatest: il } = label(run, i);
            const errCount = run.results.filter(r => r.status === 'error').length;
            return (
              <button
                key={run.id}
                onClick={() => { onSelect(i); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover transition-colors text-xs
                  ${i === selectedIndex ? 'bg-primary/10 text-foreground' : 'text-muted-foreground'}`}
              >
                <span className="flex-1 truncate">{il ? `Latest — ${t}` : t}</span>
                <span className={`text-[10px] shrink-0 ${errCount > 0 ? 'text-destructive' : 'text-success'}`}>{s}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const BenchmarkPanel = () => {
  const [view, setView] = useState<TabView>('setup');
  const [selectedRunIndex, setSelectedRunIndex] = useState(0);

  const {
    selectedModelIds,
    selectedTestIds,
    progress,
    activeRunId,
    runs,
    setSelectedModels,
    setSelectedTests,
    startRun,
    abortRun,
    clearRuns,
  } = useBenchmarkStore();

  const allModelsList = useModelStore(s => s.models);
  const allModels = useMemo(() => allModelsList.filter(m => m.enabled), [allModelsList]);
  const modelsKey = useMemo(() => [...allModels.map(m => m.id)].sort().join(','), [allModels]);
  const prevEnabledIdsRef = useRef<string[] | null>(null);
  const isRunning = activeRunId !== null;

  useEffect(() => {
    const enabled = useModelStore.getState().models.filter(m => m.enabled).map(m => m.id);
    if (enabled.length === 0) return;

    const { selectedModelIds: sel, setSelectedModels: setModels } = useBenchmarkStore.getState();

    if (prevEnabledIdsRef.current === null) {
      prevEnabledIdsRef.current = enabled;
      if (sel.length === 0) {
        setModels(enabled);
      }
      return;
    }

    const prev = prevEnabledIdsRef.current;
    const newlyAdded = enabled.filter(id => !prev.includes(id));
    prevEnabledIdsRef.current = enabled;

    setModels(prevSel => {
      const pruned = prevSel.filter(id => enabled.includes(id));
      const toAdd = newlyAdded.filter(id => !pruned.includes(id));
      if (toAdd.length === 0 && pruned.length === prevSel.length) return prevSel;
      return [...pruned, ...toAdd];
    });
  }, [modelsKey]);

  const activeRun = activeRunId ? runs.find(r => r.id === activeRunId) : undefined;
  const viewedRun = activeRun ?? runs[selectedRunIndex] ?? runs[0];
  const viewedIdx = viewedRun ? runs.findIndex(r => r.id === viewedRun.id) : 0;
  const previousRun = runs[viewedIdx + 1];

  const handleSelectAllModels = () => setSelectedModels(allModels.map(m => m.id));
  const handleClearModels = () => setSelectedModels([]);

  const handleSelectAllTests = () => setSelectedTests(ALL_BENCHMARK_TESTS.map(t => t.id));
  const handleClearTests = () => setSelectedTests([]);

  const handleToggleModel = (id: string) => {
    setSelectedModels(
      selectedModelIds.includes(id)
        ? selectedModelIds.filter(x => x !== id)
        : [...selectedModelIds, id],
    );
  };

  const handleToggleTest = (id: string) => {
    setSelectedTests(
      selectedTestIds.includes(id)
        ? selectedTestIds.filter(x => x !== id)
        : [...selectedTestIds, id],
    );
  };

  const handleStart = () => {
    setSelectedRunIndex(0);
    setView('results');
    void startRun();
  };

  const activeModels = allModels.filter(m => selectedModelIds.includes(m.id));
  const activeTests = ALL_BENCHMARK_TESTS.filter(t => selectedTestIds.includes(t.id));

  const totalFunctionalTests = ALL_BENCHMARK_TESTS
    .filter(t => selectedTestIds.includes(t.id))
    .reduce((s, t) => s + (t.functionalTests?.length ?? 0), 0);

  const liveTotal =
    activeRun && activeRun.selectedModelIds.length && activeRun.selectedTestIds.length
      ? activeRun.selectedModelIds.length * activeRun.selectedTestIds.length
      : 0;
  const liveDone =
    activeRun?.results.filter(
      r => r.status === 'done' || r.status === 'error' || r.status === 'skipped',
    ).length ?? 0;

  const canRun = activeModels.length > 0 && activeTests.length > 0 && !isRunning;

  return (
    <BenchmarkErrorBoundary>
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <FlaskConical className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Benchmark</span>
        <div className="flex ml-auto gap-1">
          <button
            onClick={() => setView('setup')}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              view === 'setup'
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Setup
          </button>
          <button
            onClick={() => setView('results')}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              view === 'results'
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Results {runs.length > 0 && `(${runs.length})`}
          </button>
        </div>
        {view === 'results' && runs.length > 1 && (
          <RunHistoryDropdown
            runs={runs}
            selectedIndex={selectedRunIndex}
            onSelect={setSelectedRunIndex}
          />
        )}
      </div>

      {view === 'setup' ? (
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col lg:flex-row gap-0 h-full">
            {/* Left: Model selection */}
            <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-border">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground">Models</span>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllModels}
                    className="text-[10px] text-primary hover:underline"
                    disabled={isRunning}
                  >
                    all
                  </button>
                  <button
                    onClick={handleClearModels}
                    className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                    disabled={isRunning}
                  >
                    none
                  </button>
                </div>
              </div>
              <div className="p-1 space-y-0.5">
                {allModels.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-2 py-3">
                    No enabled models. Add models in Settings.
                  </p>
                ) : (
                  allModels.map(m => (
                    <ModelRow
                      key={m.id}
                      model={m}
                      selected={selectedModelIds.includes(m.id)}
                      onToggle={() => handleToggleModel(m.id)}
                      disabled={isRunning}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Right: Test selection */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Tests</span>
                  {totalFunctionalTests > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-success/10 text-success">
                      {totalFunctionalTests} unit tests
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllTests}
                    className="text-[10px] text-primary hover:underline"
                    disabled={isRunning}
                  >
                    all
                  </button>
                  <button
                    onClick={handleClearTests}
                    className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
                    disabled={isRunning}
                  >
                    none
                  </button>
                </div>
              </div>
              <div className="p-1 space-y-0.5">
                {ALL_BENCHMARK_TESTS.map(t => (
                  <TestRow
                    key={t.id}
                    test={t}
                    selected={selectedTestIds.includes(t.id)}
                    onToggle={() => handleToggleTest(t.id)}
                    disabled={isRunning}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          {viewedRun ? (
            <BenchmarkLeaderboard run={viewedRun} previousRun={previousRun} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <BarChart3 className="h-8 w-8 opacity-30" />
              <p className="text-sm">No benchmark runs yet.</p>
              <button
                onClick={() => setView('setup')}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Set up a run <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Progress grid (shown while running) */}
      {isRunning && (
        <div className="shrink-0 border-t border-border bg-surface-panel">
          <div className="px-3 py-1.5 flex items-center gap-2">
            <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
            <span className="text-xs text-muted-foreground flex-1">
              {liveTotal > 0
                ? `Running · ${liveDone}/${liveTotal} tests — Results tab shows the live leaderboard`
                : 'Starting benchmark…'}
            </span>
          </div>
          <div className="overflow-x-auto px-3 pb-2">
            <table className="text-[10px] border-collapse w-full min-w-max">
              <thead>
                <tr>
                  <th className="text-left text-muted-foreground font-normal pb-1 pr-2 whitespace-nowrap">
                    Model
                  </th>
                  {ALL_BENCHMARK_TESTS.filter(t => selectedTestIds.includes(t.id)).map(t => (
                    <th
                      key={t.id}
                      className="text-center text-muted-foreground font-normal pb-1 px-1.5 whitespace-nowrap"
                    >
                      {t.name.split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeModels.map(m => (
                  <tr key={m.id}>
                    <td className="pr-2 py-0.5 text-foreground whitespace-nowrap truncate max-w-[120px]">
                      {m.name}
                    </td>
                    {ALL_BENCHMARK_TESTS.filter(t => selectedTestIds.includes(t.id)).map(t => (
                      <td key={t.id} className="px-1.5 py-0.5 align-middle">
                        <StatusCell status={progress[m.id]?.[t.id]?.status} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border">
        {isRunning ? (
          <button
            onClick={abortRun}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            <Square className="h-3 w-3" />
            Abort
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={!canRun}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play className="h-3 w-3" />
            Run Benchmark
          </button>
        )}

        {!isRunning && (
          <span className="text-[10px] text-muted-foreground">
            {activeModels.length} model{activeModels.length !== 1 ? 's' : ''},{' '}
            {activeTests.length} test{activeTests.length !== 1 ? 's' : ''}
            {totalFunctionalTests > 0 && ` (${totalFunctionalTests} unit tests)`}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {runs.length > 0 && !isRunning && (
            <>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" />
                {runs.length} run{runs.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={clearRuns}
                title="Clear all runs"
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    </BenchmarkErrorBoundary>
  );
};

export default BenchmarkPanel;
