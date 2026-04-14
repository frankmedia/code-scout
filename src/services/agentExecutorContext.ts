/**
 * agentExecutorContext.ts
 *
 * Shared module-level state for the agent executor pipeline.
 * Set once per executePlan() call; read by step executors, code generation,
 * and the repair agent.
 */

import type { RepairProjectContext } from './repairAgent';
import type { ProjectIdentity } from './planGenerator';
import type { EnvironmentInfo } from './environmentProbe';
import type { PlanStep } from '@/store/workbenchStore';
import type { EscalationDecision, EscalationContext, AgentActivityPhase } from '@/store/taskStore';

export type { RepairProjectContext, ProjectIdentity, EnvironmentInfo };

// ─── ExecutionCallbacks ─────────────────────────────────────────────────────

export interface ExecutionCallbacks {
  /** When aborted (user stop), executor exits and calls onPlanStoppedEarly. */
  signal?: AbortSignal;
  onStepStart: (step: PlanStep) => void;
  onStepDone: (step: PlanStep) => void;
  onStepError: (step: PlanStep, error: string) => void;
  onAllDone: () => void;
  /** Plan stopped early because a step could not be validated/repaired */
  onPlanStoppedEarly?: (reason: string) => void;
  onLog: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
  onTerminal: (line: string) => void;
  /** Called for every stdout/stderr line emitted by a run_command step */
  onStepOutput?: (step: PlanStep, line: string) => void;
  /** Called when a server URL (http://host:port) is detected in command output */
  onStepServerUrl?: (step: PlanStep, url: string) => void;
  /** Disciplined loop: repair attempt for current step (1-based) */
  onRepairStart?: (step: PlanStep, attempt: number) => void;
  onRepairDone?: (step: PlanStep, attempt: number, validationPassed: boolean) => void;
  /**
   * Called when auto-repair is stuck. Pauses the loop and waits for the user
   * to decide how to proceed. Must return a Promise resolving to an EscalationDecision.
   * If not provided, the agent will stop after ESCALATION_THRESHOLD attempts.
   */
  onEscalateToUser?: (ctx: EscalationContext) => Promise<EscalationDecision>;
  /** Called when agent activity phase changes — for live UI feedback */
  onActivity?: (phase: AgentActivityPhase, label: string, detail?: string) => string;
  onActivityComplete?: (activityId: string) => void;
  onActivityUpdate?: (activityId: string, label: string, detail?: string) => void;
}

// ─── Module-level state ─────────────────────────────────────────────────────

let _projectContext: RepairProjectContext | undefined;
let _projectIdentity: ProjectIdentity | undefined;
let _envInfo: EnvironmentInfo | undefined;
let _skillMd: string | undefined;
let _installHistoryForCoder: string | undefined;
let _webResearchContext: string[] = [];
/** Pre-resolved scaffold reference from scaffoldRegistry — set once per plan execution */
let _scaffoldHint: string | undefined;

/** Max chars of web content to store per fetch/search (prevent context overflow). */
export const WEB_CONTENT_MAX_CHARS = 8_000;

// ─── Getters ────────────────────────────────────────────────────────────────

export function getProjectContext(): RepairProjectContext | undefined { return _projectContext; }
export function getProjectIdentity(): ProjectIdentity | undefined { return _projectIdentity; }
export function getEnvInfo(): EnvironmentInfo | undefined { return _envInfo; }
export function getSkillMd(): string | undefined { return _skillMd; }
export function getInstallHistoryForCoder(): string | undefined { return _installHistoryForCoder; }
export function getScaffoldHint(): string | undefined { return _scaffoldHint; }

/** Get the accumulated web research context (for use in post-plan summary). */
export function getWebResearchContext(): string[] { return _webResearchContext; }

// ─── Setters ────────────────────────────────────────────────────────────────

export function setProjectContext(ctx: RepairProjectContext | undefined): void { _projectContext = ctx; }
export function setProjectIdentity(id: ProjectIdentity | undefined): void { _projectIdentity = id; }
export function setEnvInfo(info: EnvironmentInfo | undefined): void { _envInfo = info; }
export function setSkillMd(md: string | undefined): void { _skillMd = md; }
export function setInstallHistoryForCoder(ctx: string | undefined): void { _installHistoryForCoder = ctx; }
export function setScaffoldHint(hint: string | undefined): void { _scaffoldHint = hint; }

export function addWebResearchContext(entry: string): void {
  _webResearchContext.push(entry);
}

export function getWebResearchContextLength(): number {
  return _webResearchContext.length;
}

export function getRecentWebResearchContext(n: number): string[] {
  return _webResearchContext.slice(-n);
}

// ─── Reset ──────────────────────────────────────────────────────────────────

/** Clear all module-level state. Called at the start of each executePlan(). */
export function resetAgentState(): void {
  _projectContext = undefined;
  _projectIdentity = undefined;
  _envInfo = undefined;
  _skillMd = undefined;
  _installHistoryForCoder = undefined;
  _webResearchContext = [];
  _scaffoldHint = undefined;
}
