/**
 * Agent-mode diagnostics (heartbeat / stall hints).
 * Separate from the model stream deadline in `modelApi` (~15 min) — that aborts hung HTTP streams.
 * Heartbeat is a short cadence “still alive?” check so long reasoning or local LLM gaps feel explainable.
 */
export const DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS = 30_000;

/** No stream chunk or status change for this long → first warning, then repeat each heartbeat. */
export const DEFAULT_AGENT_STALL_WARNING_AFTER_MS = 45_000;

/**
 * Maximum consecutive orchestrator rounds with no tool calls before the agent gives up.
 * If a model can't use tools after a few nudges, it won't — exit fast with a clear message.
 */
export const DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS = 4;

/**
 * Maximum total rounds the orchestrator agent loop will run before stopping.
 */
export const DEFAULT_AGENT_MAX_ROUNDS = 50;

/**
 * How many times the agent may call the same tool with near-identical arguments before
 * receiving an escalating "try a different strategy" nudge.
 */
export const DEFAULT_AGENT_REPETITION_NUDGE_AT = 3;

/**
 * After this many near-identical repeated tool calls the loop force-exits with an
 * actionable explanation rather than continuing to spin.
 */
export const DEFAULT_AGENT_REPETITION_EXIT_AT = 6;

/**
 * Maximum rounds the Coder sub-loop may run per single `delegate_to_coder` call.
 */
export const DEFAULT_AGENT_MAX_CODER_ROUNDS = 30;

/**
 * Coder sub-loop: consecutive text-only (no tool) rounds before giving up, when no tools have run yet.
 */
export const DEFAULT_AGENT_MAX_CODER_NO_TOOL_ROUNDS = 3;

/** Orchestrator/Coder: tool-call JSON rejected by API — retry with repair hint this many times. */
export const DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS = 3;

/** Orchestrator/Coder: context overflow — prune and retry this many times before giving up. */
export const DEFAULT_AGENT_MAX_CONTEXT_ERRORS = 3;

/**
 * After this many **consecutive** failed verification runs (build/test after mutations),
 * inject a user message nudging web_search / fetch_url before retrying the same local fix.
 */
export const DEFAULT_AGENT_VERIFY_FAIL_WEB_NUDGE_AFTER = 2;

/**
 * Maximum characters returned from a single `read_file` tool call.
 * Files larger than this are truncated with a notice so the model can still
 * act on the visible portion or request a specific range.
 */
export const DEFAULT_AGENT_MAX_FILE_READ_CHARS = 8_000;

/**
 * Number of recent chat messages included as context when starting an agent run.
 * Higher values give the agent more conversation history but increase token cost.
 */
export const DEFAULT_AGENT_HISTORY_MESSAGES = 50;

/**
 * How long (ms) to wait after launching a background process before the agent
 * continues. Increase on slower machines where servers take longer to start.
 */
export const DEFAULT_AGENT_BACKGROUND_SETTLE_MS = 6_000;

/**
 * Soft warning threshold for `write_to_file` content length.
 * When a model tries to write a file larger than this, a warning is logged so the
 * user can see that the agent is producing a very large file in one shot.
 * Small local models tend to hallucinate or truncate when asked to write large files —
 * keeping files under this limit reduces errors significantly.
 */
export const DEFAULT_AGENT_WARN_WRITE_FILE_CHARS = 10_000;

/**
 * Hard cap for `write_to_file` content.  Writes larger than this are rejected with
 * an explanatory error so the model is forced to split the work into smaller files.
 * Prevents runaway writes that overflow context windows on subsequent reads.
 */
export const DEFAULT_AGENT_MAX_WRITE_FILE_CHARS = 50_000;
