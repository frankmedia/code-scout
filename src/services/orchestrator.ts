import { Plan, PlanStep, ChatImagePart, useWorkbenchStore } from '@/store/workbenchStore';
import { ModelConfig, useModelStore } from '@/store/modelStore';
import { useTaskStore, OrchestratorState, EscalationContext, EscalationDecision } from '@/store/taskStore';
import { generatePlan, generateMockPlan, type ProjectIdentity } from './planGenerator';
import { executePlan, ExecutionCallbacks, MAX_REPAIR_ATTEMPTS_PER_STEP } from './agentExecutor';
import { TokenUsage } from './modelApi';
import { isTauri } from '@/lib/tauri';
import { probeEnvironment, writeEnvironmentCache, readOrReprobeEnvironment, type EnvironmentInfo } from './environmentProbe';
import type { AgentActivityPhase } from '@/store/taskStore';
import { buildInstallContext } from './installTracker';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import { resolveEffectiveRoot } from './memoryManager';

// The orchestrator is the central runtime controller.
// It manages task state transitions and coordinates agents.
// It is NOT an LLM — it is deterministic application code.

export interface OrchestratorCallbacks {
  onStateChange?: (state: OrchestratorState) => void;
  /** May return a Promise (e.g. await executePlan inside). */
  onPlanReady?: (plan: Plan) => void | Promise<void>;
  onStepStart?: (step: PlanStep, index: number) => void;
  onStepDone?: (step: PlanStep, index: number) => void;
  onStepError?: (step: PlanStep, index: number, error: string) => void;
  onLog?: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
  onStatus?: (status: string) => void;
  onTokens?: (usage: TokenUsage) => void;
  /** Live stdout/stderr line from a run_command step */
  onStepOutput?: (step: PlanStep, line: string) => void;
  /** Server URL detected in command output (e.g. http://localhost:5173) */
  onStepServerUrl?: (step: PlanStep, url: string) => void;
  /** Repair loop: attempt 1..N for current step */
  onRepairStart?: (step: PlanStep, attempt: number) => void;
  onRepairDone?: (step: PlanStep, attempt: number, validationPassed: boolean) => void;
  /** Execution stopped because validation/repair failed (onComplete not called) */
  onPlanStoppedEarly?: (reason: string) => void;
  /**
   * Escalation: called when agent is stuck. Pauses execution until user decides.
   * If not provided, the taskStore's built-in escalation UI is used automatically.
   */
  onEscalateToUser?: (ctx: EscalationContext) => Promise<EscalationDecision>;
}

export interface PlanningContext {
  userGoal: string;
  files: import('@/store/workbenchStore').FileNode[];
  projectName: string;
  skillMd?: string;
  /** Structured project identity — framework, PM, language, etc. */
  projectIdentity?: ProjectIdentity;
  orchestratorModel?: ModelConfig;
  coderModel?: ModelConfig;
  /** Absolute path to the open project — used for environment probing. */
  projectPath?: string;
  /** Images from the latest user message when planning (vision-capable orchestrator). */
  userImages?: ChatImagePart[];
}

class Orchestrator {
  private state: OrchestratorState = 'IDLE';
  private callbacks: OrchestratorCallbacks = {};
  private skippedStepIds: Set<string> = new Set();
  /** Shared by planning + plan execution for Stop / cancelTask. */
  private taskAbort: AbortController | null = null;
  /** Persisted across startTask → executePlan so the coder agent gets env context. */
  private lastEnvInfo: EnvironmentInfo | undefined;

  private ensureTaskAbort(): AbortController {
    if (!this.taskAbort) this.taskAbort = new AbortController();
    return this.taskAbort;
  }

  private clearTaskAbort(): void {
    this.taskAbort = null;
  }

  // ─── State transitions ────────────────────────────────────────────────────

  private transition(newState: OrchestratorState) {
    this.state = newState;
    useTaskStore.getState().setOrchestratorState(newState);
    this.callbacks.onStateChange?.(newState);
  }

  getState(): OrchestratorState {
    return this.state;
  }

  // ─── Task lifecycle ──────────────────────────────────────────────────────

  async startTask(
    context: PlanningContext,
    callbacks: OrchestratorCallbacks,
  ): Promise<Plan | null> {
    this.callbacks = callbacks;
    this.skippedStepIds = new Set();

    const taskStore = useTaskStore.getState();
    taskStore.startTask(context.userGoal);
    taskStore.addEvent('task_created', `Planning: ${context.userGoal.slice(0, 60)}`);

    this.clearTaskAbort();
    const planSignal = this.ensureTaskAbort().signal;

    this.transition('PLANNING');

    // ── Phase 1: generate the plan (AI call) ──────────────────────────────────
    // This is the only thing inside the try/catch. Execution errors from
    // onPlanReady must NOT reach this catch or they'll be misread as planning
    // failures and trigger a spurious mock-plan restart.
    let plan: Plan;
    let planError: string | null = null;

    // Probe the runtime environment before planning so the AI knows which
    // tools (node, npm, bun, etc.) are actually installed.
    // Re-probe if the cached data is missing, stale (>4h), or pre-fix (no chipModel).
    let envInfo: EnvironmentInfo | undefined;
    if (isTauri()) {
      try {
        callbacks.onStatus?.('Probing environment…');
        // Try reading from disk first — only re-probe if stale or missing
        const cached = context.projectPath
          ? await readOrReprobeEnvironment(context.projectPath)
          : null;
        if (cached) {
          envInfo = cached;
          callbacks.onLog?.(`Environment (cached): ${cached.summary}`, 'info');
        } else {
          envInfo = await probeEnvironment(context.projectPath);
          callbacks.onLog?.(`Environment: ${envInfo.summary}`, 'info');
          if (context.projectPath) {
            writeEnvironmentCache(context.projectPath, envInfo).catch(() => {});
          }
        }
        this.lastEnvInfo = envInfo;
        // Also push to workbenchStore so chat and other components see it
        useWorkbenchStore.getState().setEnvInfo(envInfo);
      } catch {
        // Non-fatal — proceed without env info
      }
    }

    // ── Gather install history + agent memory for the planner ────────────────
    let installHistory: string | undefined;
    let agentMemory: string | undefined;
    if (isTauri() && context.projectPath) {
      try {
        const root = resolveEffectiveRoot(context.projectPath, context.files);
        installHistory = await buildInstallContext(root);
        if (installHistory) {
          callbacks.onLog?.(`Loaded install history for planning context`, 'info');
        }
      } catch {
        // Non-fatal
      }
    }
    try {
      agentMemory = useAgentMemoryStore.getState().buildMemoryPrompt(context.projectName, 2000);
    } catch {
      // Non-fatal
    }

    try {
      if (context.orchestratorModel) {
        callbacks.onStatus?.(`Connecting to ${context.orchestratorModel.modelId}`);
        plan = await generatePlan({
          userRequest: context.userGoal,
          files: context.files,
          projectName: context.projectName,
          skillMd: context.skillMd,
          projectIdentity: context.projectIdentity,
          shellCapable: isTauri(),
          userImages: context.userImages,
          envInfo,
          installHistory: installHistory || undefined,
          agentMemory: agentMemory || undefined,
          modelId: context.orchestratorModel.modelId,
          provider: context.orchestratorModel.provider,
          endpoint: context.orchestratorModel.endpoint,
          apiKey: context.orchestratorModel.apiKey,
          onStatus: callbacks.onStatus,
          onTokens: callbacks.onTokens,
          signal: planSignal,
        });
      } else {
        plan = generateMockPlan(context.userGoal, context.projectIdentity, context.files);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.clearTaskAbort();
        return null;
      }
      planError = err instanceof Error ? err.message : 'Planning failed';
      this.transition('FAILED');
      taskStore.addEvent('task_failed', 'Planning failed', planError);
      callbacks.onError?.(planError);
      plan = generateMockPlan(context.userGoal, context.projectIdentity, context.files);
    }

    // ── Phase 2: hand the plan to the caller (may run executePlan inside) ─────
    // Outside the planning try/catch so execution errors propagate normally.
    this.transition('WAITING_FOR_PLAN_APPROVAL');
    taskStore.addEvent('plan_generated', `Plan ready: ${plan.steps.length} steps`, plan.summary);
    if (!planError) taskStore.addEvent('awaiting_plan_approval', 'Waiting for user approval');
    await Promise.resolve(callbacks.onPlanReady?.(plan));
    this.clearTaskAbort();
    return planError ? null : plan;
  }

  async executePlan(
    plan: Plan,
    skippedStepIds: Set<string>,
    callbacks: OrchestratorCallbacks,
    coderModel?: ModelConfig,
    projectIdentity?: ProjectIdentity,
  ): Promise<void> {
    this.callbacks = callbacks;
    this.skippedStepIds = skippedStepIds;

    const taskStore = useTaskStore.getState();
    const modelStore = useModelStore.getState();

    // Resolve models — caller override takes priority, then role-based fallback
    const resolvedCoderModel = coderModel ?? modelStore.getModelForRole('coder');
    const resolvedVerifierModel = modelStore.getModelForRole('tester');

    this.transition('EXECUTING_STEP');
    taskStore.addEvent('plan_approved', 'Plan approved, executing steps');

    const filteredPlan = {
      ...plan,
      steps: plan.steps.filter(s => !skippedStepIds.has(s.id)),
    };

    const execCallbacks: ExecutionCallbacks = {
      signal: this.ensureTaskAbort().signal,
      onStepStart: (step) => {
        const idx = filteredPlan.steps.findIndex(s => s.id === step.id);
        taskStore.setCurrentStepIndex(idx);
        taskStore.addEvent('step_started', `Step ${idx + 1}: ${step.description}`, undefined, step.id);
        this.transition('EXECUTING_STEP');
        callbacks.onStepStart?.(step, idx);
      },
      onStepDone: (step) => {
        const idx = filteredPlan.steps.findIndex(s => s.id === step.id);
        taskStore.addEvent('step_completed', `Step ${idx + 1} complete`, undefined, step.id);
        this.transition('VERIFYING_RESULT');
        callbacks.onStepDone?.(step, idx);
      },
      onStepError: (step, error) => {
        const idx = filteredPlan.steps.findIndex(s => s.id === step.id);
        taskStore.addEvent('step_failed', `Step ${idx + 1} failed`, error, step.id);
        this.transition('FAILED');
        callbacks.onStepError?.(step, idx, error);
      },
      onAllDone: () => {
        console.log('[LOOP-DEBUG] orchestrator onAllDone fired — calling callbacks.onComplete');
        taskStore.clearRepairContext();
        this.transition('COMPLETED');
        taskStore.addEvent('task_completed', 'All steps completed successfully');
        callbacks.onComplete?.();
      },
      onPlanStoppedEarly: (reason) => {
        taskStore.clearRepairContext();
        const cancelled = reason === 'Cancelled by user';
        this.transition(cancelled ? 'CANCELLED' : 'FAILED');
        taskStore.addEvent(
          cancelled ? 'task_cancelled' : 'task_failed',
          cancelled ? 'Plan cancelled by user' : 'Plan stopped — validation/repair failed',
          reason.slice(0, 300),
        );
        if (!cancelled) callbacks.onError?.(reason.slice(0, 500));
        callbacks.onPlanStoppedEarly?.(reason);
      },
      onRepairStart: (step, attempt) => {
        this.transition('REPAIRING');
        taskStore.setRepairContext(attempt, step.description);
        taskStore.addEvent('step_repair_started', `Repair ${attempt}/${MAX_REPAIR_ATTEMPTS_PER_STEP}: ${step.description.slice(0, 50)}`, undefined, step.id);
        callbacks.onStatus?.(`Repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS_PER_STEP}`);
        callbacks.onRepairStart?.(step, attempt);
      },
      onRepairDone: (step, attempt, validationPassed) => {
        if (validationPassed) {
          taskStore.clearRepairContext();
          this.transition('VERIFYING_RESULT');
        } else {
          taskStore.addEvent(
            'step_repair_failed',
            `Repair ${attempt}/${MAX_REPAIR_ATTEMPTS_PER_STEP} did not pass validation`,
            step.description.slice(0, 120),
            step.id,
          );
        }
        callbacks.onRepairDone?.(step, attempt, validationPassed);
      },
      onLog: (message, type) => {
        callbacks.onLog?.(message, type);
      },
      onTerminal: (line) => {
        callbacks.onLog?.(line);
      },
      onStepOutput: (step, line) => {
        callbacks.onStepOutput?.(step, line);
      },
      onStepServerUrl: (step, url) => {
        callbacks.onStepServerUrl?.(step, url);
      },
      // ── Escalation — pause and ask user ─────────────────────────────────
      onEscalateToUser: callbacks.onEscalateToUser ?? ((ctx: EscalationContext) => {
        // Default: use the taskStore escalation mechanism (UI picks it up)
        this.transition('AWAITING_USER_INPUT');
        return taskStore.requestEscalation(ctx);
      }),
      // ── Activity tracking ─────────────────────────────────────────────
      onActivity: (phase: AgentActivityPhase, label: string, detail?: string) => {
        return taskStore.setActivity({ phase, label, detail });
      },
      onActivityComplete: (id: string) => {
        taskStore.completeActivity(id);
      },
      onActivityUpdate: (id: string, label: string, detail?: string) => {
        taskStore.updateActivity(id, { label, detail });
      },
    };

    try {
      await executePlan(filteredPlan, execCallbacks, resolvedCoderModel, resolvedVerifierModel, projectIdentity, this.lastEnvInfo);
    } finally {
      this.clearTaskAbort();
    }
  }

  /** Abort planning / plan execution streams. Executor exits cleanly; UI should reset thinking state. */
  cancelTask() {
    this.taskAbort?.abort();
    this.transition('CANCELLED');
    const taskStore = useTaskStore.getState();
    taskStore.addEvent('task_cancelled', 'Task cancelled by user');
    taskStore.clearActivities();
    // If stuck in escalation, resolve it with stop
    if (taskStore.escalationContext) {
      taskStore.resolveEscalation({ action: 'stop' });
    }
  }
}

// Singleton orchestrator instance
export const orchestrator = new Orchestrator();
