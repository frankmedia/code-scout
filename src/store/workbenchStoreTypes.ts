/**
 * Types for the workbench store.
 * Extracted so small LLMs can reference types without loading the full store.
 * The main store re-exports everything from here.
 */

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
  language?: string;
}

export interface ChatImagePart {
  mediaType: string;
  dataBase64: string;
}

export type ToolInvocationStatus =
  | 'pending_user'
  | 'auto_queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';

/** OpenAI-style tool execution row (Cursor-like run_terminal_cmd). */
export interface ToolInvocation {
  id: string;
  name: string;
  argsJson: string;
  command?: string;
  status: ToolInvocationStatus;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  errorMessage?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  agent?: 'orchestrator' | 'coder';
  /** Inline images for multimodal chat (not persisted in full to saved history). */
  images?: ChatImagePart[];
  /** Model-requested tools (e.g. run_terminal_cmd) — desktop may require user confirmation. */
  toolInvocations?: ToolInvocation[];
  /** When true, render the inline plan card after this message. */
  showPlanCard?: boolean;
}

/** Last detected dev server URL — set by background `run_terminal_cmd` or plan steps. */
export let lastDevServerUrl: string | null = null;
export function setLastDevServerUrl(url: string | null): void { lastDevServerUrl = url; }

export type PlanAction =
  | 'create_file'
  | 'edit_file'
  | 'delete_file'
  | 'run_command'
  | 'web_search'
  | 'captcha_detect'
  | 'captcha_click'
  | 'captcha_solve'
  | 'captcha_get_image'
  | 'get_links'
  | 'crawl'
  | 'sitemap'
  | 'detect_form'
  | 'save_text'
  | 'save_file'
  | 'save_json'
  | 'save_csv'
  | 'save_markdown'
  | 'save_screenshot'
  | 'fetch_url'
  | 'browse_web'
  // Browser automation actions
  | 'browser_launch'
  | 'browser_goto'
  | 'browser_click'
  | 'browser_fill'
  | 'browser_extract'
  | 'browser_screenshot'
  | 'browser_scroll'
  | 'browser_wait'
  | 'browser_close';

export interface PlanStep {
  id: string;
  action: PlanAction;
  path?: string;
  command?: string;
  /** Full file content for deterministic create_file steps. */
  content?: string;
  description: string;
  /** Browser actions: CSS selector or text to find element */
  selector?: string;
  /** Browser actions: value to fill in input */
  value?: string;
  /** Browser actions: URL to navigate to */
  url?: string;
  status: 'pending' | 'running' | 'repairing' | 'done' | 'error';
  /** Set when status is error — execution or verification failure reason */
  errorMessage?: string;
  /** How many repair attempts have run for this step (disciplined loop) */
  repairAttemptCount?: number;
  /** Last validation command run after this step */
  lastValidationCommand?: string;
  /** Truncated validation failure output for UI */
  lastValidationError?: string;
  /** Full diagnostic when the plan stops on this step (retry limit or stuck error) */
  stopDiagnostic?: string;
  stopDiagnosticKind?: 'model' | 'infra' | 'stuck';
  diff?: { before: string; after: string };
  /** Last line of live output from a running shell command */
  liveOutput?: string;
  /** Full accumulated stdout from a run_command step */
  fullOutput?: string;
  /** Detected server URL (e.g. http://localhost:5173) emitted by a background process */
  serverUrl?: string;
}

export interface Plan {
  id: string;
  summary: string;
  steps: PlanStep[];
  status: 'pending' | 'executing' | 'done' | 'rejected';
  /** Command to run after file-changing steps to verify the project (e.g. npm run build) */
  validationCommand?: string;
}

export interface FileSnapshot {
  path: string;
  content: string | null;
  action: 'created' | 'edited' | 'deleted';
}

export interface TerminalTab {
  id: string;
  name: string;
  output: string[];
  /** True when this tab was created for an agent session (shows bot icon in UI). */
  isAgent?: boolean;
}

export type AppMode = 'ask' | 'plan' | 'build' | 'chat' | 'agent';

/** Reserved center tab id for the execution plan (not a file path). */
export const CENTER_TAB_PLAN = ':plan';
/** Reserved center tab id for the benchmark panel (not a file path). */
export const CENTER_TAB_BENCHMARK = ':benchmark';
