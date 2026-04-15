import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { runBenchmark } from '@/services/benchmarkRunner';
import { buildLeaderboard } from '@/services/benchmarkScorer';
import { ALL_BENCHMARK_TESTS } from '@/services/benchmarkTests';
import { useModelStore } from '@/store/modelStore';
import { useProjectStore } from '@/store/projectStore';
import type { BenchmarkTest, BenchmarkRun, TestRunResult, ModelBenchmarkScore, RunProgress } from '@/types/benchmark';

const BENCHMARKS_FILE = '.codescout/benchmarks.json';

// ─── Store shape ──────────────────────────────────────────────────────────────

interface BenchmarkStoreState {
  runs: BenchmarkRun[];
  activeRunId: string | null;

  // Progress grid: modelId → testId → RunProgress
  progress: Record<string, Record<string, RunProgress>>;

  // Selections
  selectedModelIds: string[];
  selectedTestIds: string[];

  // Actions
  /** Pass an array, or an updater like React `setState` (used when syncing with the model list). */
  setSelectedModels: (ids: string[] | ((prev: string[]) => string[])) => void;
  setSelectedTests: (ids: string[]) => void;
  startRun: () => Promise<void>;
  abortRun: () => void;
  clearRuns: () => void;

  // Derived helpers
  activeRun: () => BenchmarkRun | undefined;
  leaderboard: () => ModelBenchmarkScore[];
}

// Held outside Zustand so it's not serialized
let abortController: AbortController | null = null;

function asStringArray(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  return v.filter((x): x is string => typeof x === 'string');
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

async function persistRunsToDisk(runs: BenchmarkRun[]): Promise<void> {
  try {
    const projectPath = useProjectStore.getState().activeProjectId
      ? (() => {
          // projectStore keeps the disk path in localStorage as a secondary artifact;
          // we read it the same way memoryManager does.
          const raw = localStorage.getItem('scout-project-path');
          return raw ?? null;
        })()
      : null;

    if (!projectPath) return;

    const { invoke } = await import('@tauri-apps/api/core');
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const dirPath = `${projectPath}${sep}.codescout`;
    const filePath = `${projectPath}${sep}${BENCHMARKS_FILE}`;

    try { await invoke('create_dir', { path: dirPath }); } catch { /* already exists */ }
    await invoke('write_file', {
      path: filePath,
      content: JSON.stringify({ benchmarkRuns: runs }, null, 2),
    });
  } catch {
    // Persistence is best-effort — silently ignore if Tauri not available
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useBenchmarkStore = create<BenchmarkStoreState>()(
  persist(
    (set, get) => ({
      runs: [],
      activeRunId: null,
      progress: {},
      selectedModelIds: [],
      selectedTestIds: ALL_BENCHMARK_TESTS.map(t => t.id),

      setSelectedModels: (ids) => set(s => {
        const prev = Array.isArray(s.selectedModelIds) ? s.selectedModelIds : [];
        const next = typeof ids === 'function' ? ids(prev) : ids;
        return { selectedModelIds: Array.isArray(next) ? next : prev };
      }),
      setSelectedTests: (ids) => set({ selectedTestIds: ids }),

      abortRun: () => {
        abortController?.abort();
        const { activeRunId, runs } = get();
        if (!activeRunId) return;
        set({
          runs: runs.map(r =>
            r.id === activeRunId ? { ...r, status: 'aborted', finishedAt: new Date().toISOString() } : r,
          ),
          activeRunId: null,
        });
      },

      clearRuns: () => set({ runs: [], activeRunId: null, progress: {} }),

      activeRun: () => {
        const { runs, activeRunId } = get();
        return runs.find(r => r.id === activeRunId);
      },

      leaderboard: () => {
        const { runs } = get();
        const latest = [...runs].sort(
          (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
        )[0];
        return latest?.scores ?? [];
      },

      startRun: async () => {
        const { selectedModelIds, selectedTestIds } = get();

        const allModels = useModelStore.getState().models;
        const models = allModels.filter(m => selectedModelIds.includes(m.id) && m.enabled);
        const tests: BenchmarkTest[] = ALL_BENCHMARK_TESTS.filter(t =>
          selectedTestIds.includes(t.id),
        );

        if (models.length === 0 || tests.length === 0) return;

        abortController = new AbortController();
        const runId = crypto.randomUUID();
        const startedAt = new Date().toISOString();

        const newRun: BenchmarkRun = {
          id: runId,
          startedAt,
          status: 'running',
          selectedModelIds: models.map(m => m.id),
          selectedTestIds: tests.map(t => t.id),
          results: [],
          // Non-empty from t=0 so Results shows the leaderboard shell and updates live (not a blank “starting” screen)
          scores: buildLeaderboard(models, []),
        };

        set(s => ({
          runs: [newRun, ...s.runs],
          activeRunId: runId,
          progress: {},
        }));

        const onProgress = (p: RunProgress) => {
          const { result: terminal, ...gridCell } = p;
          set(s => {
            const nextProgress = {
              ...s.progress,
              [p.modelConfigId]: {
                ...(s.progress[p.modelConfigId] ?? {}),
                [p.testId]: gridCell,
              },
            };
            if (!terminal) {
              return { progress: nextProgress };
            }
            const run = s.runs.find(r => r.id === runId);
            if (!run) {
              return { progress: nextProgress };
            }
            const nextResults = [
              ...run.results.filter(
                r => !(r.modelId === terminal.modelId && r.testId === terminal.testId),
              ),
              terminal,
            ];
            const scores = buildLeaderboard(models, nextResults);
            return {
              progress: nextProgress,
              runs: s.runs.map(r =>
                r.id === runId ? { ...r, results: nextResults, scores } : r,
              ),
            };
          });
        };

        try {
          const results = await runBenchmark(
            models,
            tests,
            abortController.signal,
            { onProgress, concurrencyLimit: 3 },
          );

          const scores = buildLeaderboard(models, results);
          const finishedRun: BenchmarkRun = {
            ...newRun,
            status: abortController.signal.aborted ? 'aborted' : 'done',
            finishedAt: new Date().toISOString(),
            results,
            scores,
          };

          set(s => ({
            runs: s.runs.map(r => r.id === runId ? finishedRun : r),
            activeRunId: null,
          }));

          await persistRunsToDisk(get().runs);
        } catch (err) {
          set(s => ({
            runs: s.runs.map(r =>
              r.id === runId
                ? { ...r, status: 'aborted', finishedAt: new Date().toISOString() }
                : r,
            ),
            activeRunId: null,
          }));
        }
      },
    }),
    {
      name: 'scout-benchmarks',
      merge: (persisted, current) => {
        const p = persisted as Partial<
          Pick<BenchmarkStoreState, 'runs' | 'selectedModelIds' | 'selectedTestIds'>
        > | null;
        if (!p || typeof p !== 'object') return current;
        return {
          ...current,
          ...p,
          runs: Array.isArray(p.runs) ? p.runs.slice(0, 50) : current.runs,
          selectedModelIds: asStringArray(p.selectedModelIds, current.selectedModelIds),
          selectedTestIds: asStringArray(p.selectedTestIds, current.selectedTestIds),
        };
      },
      // Only persist the run history and selections, not transient progress
      partialize: (s) => ({
        runs: s.runs.slice(0, 50), // keep latest 50 runs for historical comparison
        selectedModelIds: s.selectedModelIds,
        selectedTestIds: s.selectedTestIds,
      }),
    },
  ),
);

// After localStorage rehydrate: empty model selection means "not chosen yet" → select all enabled models
useBenchmarkStore.persist.onFinishHydration(() => {
  const {
    selectedModelIds,
    selectedTestIds,
    setSelectedModels,
    setSelectedTests,
  } = useBenchmarkStore.getState();
  if (!Array.isArray(selectedModelIds)) {
    setSelectedModels([]);
  }
  if (!Array.isArray(selectedTestIds)) {
    setSelectedTests(ALL_BENCHMARK_TESTS.map(t => t.id));
  }
  const enabled = useModelStore.getState().models.filter(m => m.enabled).map(m => m.id);
  const sel = useBenchmarkStore.getState().selectedModelIds;
  if (sel.length === 0 && enabled.length > 0) {
    setSelectedModels(enabled);
  }
});
