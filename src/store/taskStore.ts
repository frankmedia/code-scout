import { create } from 'zustand';

// Only states the orchestrator actually transitions through
export type OrchestratorState =
  | 'IDLE'
  | 'PLANNING'
  | 'WAITING_FOR_PLAN_APPROVAL'
  | 'EXECUTING_STEP'
  | 'VERIFYING_RESULT'
  | 'REPAIRING'
  | 'AWAITING_USER_INPUT'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface TaskEvent {
  id: string;
  type: TaskEventType;
  timestamp: number;
  taskId?: string;
  stepId?: string;
  title: string;
  detail?: string;
}

// Only event types that are actually emitted
export type TaskEventType =
  | 'task_created'
  | 'plan_generated'
  | 'awaiting_plan_approval'
  | 'plan_approved'
  | 'plan_rejected'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_repair_started'
  | 'step_repair_failed'
  | 'verification_completed'
  | 'escalation_triggered'
  | 'escalation_resolved'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled';

// ─── Escalation ───────────────────────────────────────────────────────────────

export type EscalationDecision =
  | { action: 'continue' }
  | { action: 'skip' }
  | { action: 'stop' }
  | { action: 'hint'; hint: string }
  | { action: 'orchestrator_replan' };

export interface EscalationContext {
  stepId: string;
  stepDescription: string;
  attemptCount: number;
  errorSummary: string;
  /** History of what the repair agent tried */
  attemptHistory: string[];
}

// ─── Agent Activity ───────────────────────────────────────────────────────────

export type AgentActivityPhase =
  | 'thinking'
  | 'researching'
  | 'writing_code'
  | 'creating_file'
  | 'running_command'
  | 'verifying'
  | 'repairing'
  | 'replanning'
  | 'waiting_for_user';

export interface AgentActivity {
  id: string;
  phase: AgentActivityPhase;
  /** Short human-readable label, e.g. "Writing src/components/Button.tsx" */
  label: string;
  /** Optional detail, e.g. "Attempt 2 of 5" */
  detail?: string;
  startedAt: number;
  /** 0-100 for file writes, undefined if unknown */
  progress?: number;
  active: boolean;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface TaskStoreState {
  taskId: string | null;
  orchestratorState: OrchestratorState;
  goal: string;
  currentStepIndex: number;
  events: TaskEvent[];
  /** Current repair attempt (1-based) while in REPAIRING */
  repairAttemptCount: number;
  /** Last validation / repair error snippet for UI */
  lastRepairError: string | null;

  /** Escalation — set when agent needs human input */
  escalationContext: EscalationContext | null;
  /** Internal resolver — called by UI to unblock the agentic loop */
  _escalationResolver: ((decision: EscalationDecision) => void) | null;

  /** Live agent activities — what the agent is doing right now */
  activities: AgentActivity[];
  /** Recent completed activities (kept briefly for fade-out animation) */
  recentActivities: AgentActivity[];

  // ─── Actions ──────────────────────────────────────────────────────────────
  startTask: (goal: string) => string;
  setOrchestratorState: (state: OrchestratorState) => void;
  setCurrentStepIndex: (index: number) => void;
  setRepairContext: (attempt: number, errorSnippet: string | null) => void;
  clearRepairContext: () => void;
  addEvent: (type: TaskEventType, title: string, detail?: string, stepId?: string) => void;
  resetTask: () => void;

  /** Called by the agentic loop to pause and wait for user decision */
  requestEscalation: (ctx: EscalationContext) => Promise<EscalationDecision>;
  /** Called by the UI to provide the user's decision */
  resolveEscalation: (decision: EscalationDecision) => void;

  /** Start a new live activity */
  setActivity: (activity: Omit<AgentActivity, 'id' | 'startedAt' | 'active'>) => string;
  /** Mark an activity complete and move it to recent */
  completeActivity: (id: string) => void;
  /** Replace current activity label/detail without creating a new one */
  updateActivity: (id: string, updates: Partial<Pick<AgentActivity, 'label' | 'detail' | 'progress'>>) => void;
  /** Clear all active and recent activities */
  clearActivities: () => void;
}

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  taskId: null,
  orchestratorState: 'IDLE',
  goal: '',
  currentStepIndex: 0,
  events: [],
  repairAttemptCount: 0,
  lastRepairError: null,
  escalationContext: null,
  _escalationResolver: null,
  activities: [],
  recentActivities: [],

  startTask: (goal) => {
    const taskId = crypto.randomUUID();
    set({
      taskId,
      orchestratorState: 'PLANNING',
      goal,
      currentStepIndex: 0,
      events: [],
      repairAttemptCount: 0,
      lastRepairError: null,
      escalationContext: null,
      _escalationResolver: null,
      activities: [],
      recentActivities: [],
    });
    get().addEvent('task_created', `Task started: ${goal.slice(0, 60)}`);
    return taskId;
  },

  setOrchestratorState: (orchestratorState) => set({ orchestratorState }),

  setCurrentStepIndex: (currentStepIndex) => set({ currentStepIndex }),

  setRepairContext: (repairAttemptCount, lastRepairError) =>
    set({ repairAttemptCount, lastRepairError }),

  clearRepairContext: () => set({ repairAttemptCount: 0, lastRepairError: null }),

  addEvent: (type, title, detail, stepId) => set(s => ({
    events: [...s.events, {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      taskId: s.taskId || undefined,
      stepId,
      title,
      detail,
    }],
  })),

  resetTask: () => set({
    taskId: null,
    orchestratorState: 'IDLE',
    goal: '',
    currentStepIndex: 0,
    events: [],
    repairAttemptCount: 0,
    lastRepairError: null,
    escalationContext: null,
    _escalationResolver: null,
    activities: [],
    recentActivities: [],
  }),

  requestEscalation: (ctx) => {
    return new Promise<EscalationDecision>((resolve) => {
      set({
        orchestratorState: 'AWAITING_USER_INPUT',
        escalationContext: ctx,
        _escalationResolver: resolve,
      });
      get().addEvent('escalation_triggered', `Stuck on: ${ctx.stepDescription.slice(0, 60)}`, `After ${ctx.attemptCount} attempts`, ctx.stepId);
    });
  },

  resolveEscalation: (decision) => {
    const resolver = get()._escalationResolver;
    if (!resolver) return;
    set({
      escalationContext: null,
      _escalationResolver: null,
      orchestratorState: 'REPAIRING',
    });
    get().addEvent('escalation_resolved', `User chose: ${decision.action}`, decision.action === 'hint' ? decision.hint.slice(0, 60) : undefined);
    resolver(decision);
  },

  setActivity: (activity) => {
    const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newActivity: AgentActivity = {
      ...activity,
      id,
      startedAt: Date.now(),
      active: true,
    };
    set(s => ({ activities: [...s.activities, newActivity] }));
    return id;
  },

  completeActivity: (id) => {
    set(s => {
      const activity = s.activities.find(a => a.id === id);
      if (!activity) return s;
      const completed = { ...activity, active: false };
      return {
        activities: s.activities.filter(a => a.id !== id),
        recentActivities: [completed, ...s.recentActivities].slice(0, 5),
      };
    });
  },

  updateActivity: (id, updates) => {
    set(s => ({
      activities: s.activities.map(a => a.id === id ? { ...a, ...updates } : a),
    }));
  },

  clearActivities: () => set({ activities: [], recentActivities: [] }),
}));
