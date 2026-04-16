import { Plan, PlanStep, FileNode, ChatImagePart } from '@/store/workbenchStore';
import { ModelProvider } from '@/store/modelStore';
import { useModelStore } from '@/store/modelStore';
import { callModel, ModelRequestMessage, TokenUsage } from './modelApi';
import type { EnvironmentInfo } from './environmentProbe';
import { formatEnvForPrompt } from './environmentProbe';

// ─── System Prompt ───────────────────────────────────────────────────────────

/** Max chars of file content to inline per file. Keeps the prompt bounded. */
const MAX_FILE_INLINE_CHARS = 6_000;
/** Only inline files smaller than this — skip large generated / lock files. */
const MAX_FILE_SIZE_TO_INLINE = 80_000;
/** Extensions that are always worth inlining for debugging context. */
const ALWAYS_INLINE_NAMES = new Set([
  'package.json', 'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
  'tsconfig.json', 'tsconfig.app.json', 'index.html', 'cargo.toml',
  'go.mod', 'pyproject.toml', '.env', '.env.example',
]);

function shouldInlineFile(node: FileNode): boolean {
  if (!node.content) return false;
  if (node.content.length > MAX_FILE_SIZE_TO_INLINE) return false;
  const name = node.name.toLowerCase();
  if (ALWAYS_INLINE_NAMES.has(name)) return true;
  const ext = name.split('.').pop() ?? '';
  // Inline all source files — they're the most useful for diagnosis
  return ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'css', 'html', 'md'].includes(ext);
}

function buildFileContext(files: FileNode[]): string {
  const flat = flattenFiles(files);
  const filePaths = flat.map(f => f.path);

  const inlined: string[] = [];
  let totalChars = 0;
  // Always-inline files first, then source files, capped by total budget
  const sorted = [...flat].sort((a, b) => {
    const aP = ALWAYS_INLINE_NAMES.has(a.name.toLowerCase()) ? 0 : 1;
    const bP = ALWAYS_INLINE_NAMES.has(b.name.toLowerCase()) ? 0 : 1;
    return aP - bP;
  });
  for (const f of sorted) {
    if (!shouldInlineFile(f)) continue;
    if (totalChars > 40_000) break; // total prompt budget
    const snippet = f.content!.slice(0, MAX_FILE_INLINE_CHARS);
    const truncated = f.content!.length > MAX_FILE_INLINE_CHARS ? '\n... (truncated)' : '';
    inlined.push(`### ${f.path}\n\`\`\`\n${snippet}${truncated}\n\`\`\``);
    totalChars += snippet.length;
  }

  const pathList = filePaths.slice(0, 120).join('\n') +
    (filePaths.length > 120 ? `\n... and ${filePaths.length - 120} more` : '');

  return inlined.length > 0
    ? `## File tree\n${pathList}\n\n## File contents\n${inlined.join('\n\n')}`
    : `## File tree\n${pathList}`;
}

function buildProjectIdentityBlock(id: ProjectIdentity, projectName?: string): string {
  const lines: string[] = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    '║                    PROJECT IDENTITY                         ║',
    '║  These are FACTS about the current project. Obey them.     ║',
    '╚══════════════════════════════════════════════════════════════╝',
  ];
  if (projectName) {
    lines.push(`PROJECT_DIRECTORY: ${projectName}`);
    lines.push(`IMPORTANT: The project directory is "${projectName}". All file paths are relative to THIS directory. Do NOT create a new subdirectory or rename the project.`);
  }
  lines.push(`FRAMEWORK: ${id.framework}`);
  lines.push(`LANGUAGE: ${id.language}`);
  lines.push(`PACKAGE_MANAGER: ${id.packageManager}`);
  if (id.styling) lines.push(`STYLING: ${id.styling}`);
  if (id.entryPoints?.length) lines.push(`ENTRY_POINTS: ${id.entryPoints.join(', ')}`);
  if (id.runCommands) {
    const cmds = Object.entries(id.runCommands).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`SCRIPTS: ${cmds}`);
  }

  if (id.hasExistingProject) {
    lines.push('');
    lines.push('STATUS: PROJECT ALREADY EXISTS — it has source files, config, and dependencies.');
    lines.push('FORBIDDEN ACTIONS:');
    lines.push('  - DO NOT run "npm create vite@latest" or any scaffolding/init command');
    lines.push('  - DO NOT run "npx create-react-app" or "npx create-next-app"');
    lines.push('  - DO NOT create package.json from scratch (it already exists)');
    lines.push('  - DO NOT overwrite vite.config / tsconfig / existing config files');
    lines.push('REQUIRED: Work with the existing project. Create/edit source files only.');
  } else {
    lines.push('');
    lines.push('STATUS: EMPTY PROJECT — no source files yet.');
    lines.push('PREFER: Write files directly with create_file (package.json, index.html, main.jsx, App.jsx, CSS).');
    lines.push('AVOID: Scaffolding commands (npm create vite, npx create-react-app) — they are fragile and may fail.');
  }
  lines.push('');
  return lines.join('\n');
}

function buildSystemPrompt(
  files: FileNode[],
  projectName: string,
  skillMd: string | undefined,
  shellCapable: boolean,
  envInfo?: EnvironmentInfo,
  projectIdentity?: ProjectIdentity,
  installHistory?: string,
  agentMemory?: string,
): string {
  const fileContext = buildFileContext(files);
  const projectContext = skillMd
    ? `${skillMd}${skillMd.includes('## File tree') ? '' : `\n\n${fileContext}`}`
    : `Project: "${projectName}"\n${fileContext}`;

  // Determine project state for scaffolding rules
  const flat = flattenFiles(files);
  const hasSourceFiles = flat.some(f => /\.(jsx?|tsx?|py|rs|go|rb|php|cs|java)$/.test(f.path));
  const hasPackageJson = flat.some(f => f.name === 'package.json');
  const isEmpty = projectIdentity
    ? !projectIdentity.hasExistingProject
    : (flat.length === 0 || (!hasSourceFiles && !hasPackageJson));

  const scaffoldRules = isEmpty
    ? `IMPORTANT — Empty/new project: The user just created this project directory. It is already the current working directory. When initializing (e.g. npm create vite@latest), ALWAYS use "." (dot) for the project name/directory — NEVER use the project name "${projectName}" or you will create a nested duplicate directory. Example: \`npm create vite@latest . -- --template react\` NOT \`npm create vite@latest ${projectName}\`. ALWAYS prefer writing files directly with create_file instead of running scaffolding commands (npx create-vite, etc.) which are fragile and may fail. Write package.json, index.html, main.jsx, App.jsx, etc. directly.`
    : `This project already has files. Do NOT re-initialize or scaffold from scratch. Do NOT run npm create, npx create-vite, or any scaffolding command. Work with the existing file structure. Edit existing files or add new files alongside them.`;

  const shellRules = shellCapable
    ? `Execution context: **Desktop app** — \`run_command\` steps run on the user's machine with \`sh -c\` in the opened project directory. Prefer file edits when that is enough; use \`run_command\` for installs, builds, codegen, etc. Do **not** use \`rm -rf node_modules\` unless the user explicitly asked for a clean reinstall — it breaks validation until \`npm install\` finishes. For Node/Vite repos, set validationCommand to **npm run build** (not bare \`vite build\`). ${scaffoldRules}`
    : `Execution context: **Browser** — \`run_command\` steps cannot run here; they will be skipped at execution. Avoid \`run_command\` unless unavoidable; prefer \`create_file\` / \`edit_file\` / \`delete_file\`. For npm/git/etc., describe what the user should run locally or tell them to repeat the task in the desktop app. ${scaffoldRules}`;

  // ── PROJECT IDENTITY BLOCK — structured, unmissable directives for the LLM ──
  const identityBlock = projectIdentity ? buildProjectIdentityBlock(projectIdentity, projectName) : '';

  return `You are Code Scout AI, an expert coding assistant that generates structured execution plans.
${identityBlock}

RESPONSE FORMAT: You MUST respond with ONLY a valid JSON object.
- NO markdown, NO code fences, NO explanation before or after the JSON.
- NO "Commands to Run" section, NO "Features Implemented" table, NO narrative text.
- ONLY the JSON object. Nothing else. If you add any text outside the JSON, the response will fail to parse.
- CRITICAL: NEVER start a run_command with "cd ${projectName}" or "cd ./${projectName}" — the shell already runs with "${projectName}" as the current working directory. Writing "cd ${projectName} && ..." will always fail with "No such file or directory" because you would be trying to cd into a subdirectory of itself.
- NEVER invent a new project/directory name. The project is "${projectName}".
- If you need to run a command inside a SUBDIRECTORY (e.g. a nested package), use "cd subdirname && command". Never cd into the top-level project name itself.

The JSON must follow this exact schema:
{
  "summary": "Brief 1-sentence description of what the plan does",
  "validationCommand": "e.g. npm run build — runs after each step to ensure the project is not broken (use the best check for this repo: npm run build, npm run lint, cargo build, etc.)",
  "assumptions": ["assumption 1", "assumption 2"],
  "risks": ["risk 1", "risk 2"],
  "steps": [
    {
      "action": "create_file" | "edit_file" | "delete_file" | "run_command" | "web_search" | "fetch_url" | "browse_web",
      "path": "relative/path/to/file",
      "description": "What this step does and why",
      "risk_level": "low|medium|high",
      "command": "only for run_command, web_search (search query), or fetch_url (the URL)",
      "diff": {
        "before": "the existing code that will be changed (for edit_file only)",
        "after": "the new code after the change (for edit_file only)"
      }
    }
  ]
}

${shellRules}

Rules:
- validationCommand is optional. If the plan modifies source code that should compile, set it to the project's build command (e.g. "npm run build", "cargo build"). If the plan only edits config/data files, runs scripts, or does non-compilation tasks, OMIT validationCommand entirely — the agent will validate each step on its own. NEVER force a build validation on a plan that doesn't change compilable source code.
- action must be one of: create_file, edit_file, delete_file, run_command, web_search, fetch_url, browse_web
- **web_search**: Search the internet for docs, examples, APIs, or solutions. Put a natural-language search query in the "command" field (e.g. "react router v6 tutorial", "tailwind CSS grid examples"). The search results are automatically fed to subsequent coding steps. ALWAYS use web_search (NOT run_command) when the user asks to search, look up, research, or find information online. NEVER put a plain-English query in run_command — that will fail.
- **browse_web**: Navigate a real headless browser to a URL and extract fully-rendered page content. Use this for documentation sites, GitHub pages, SPAs, or any site that needs JavaScript to render. Put the URL in the "command" field. Supports optional "browseActions" array: [{"type":"click","selector":"..."}, {"type":"wait","ms":1000}]. Example: { "action": "browse_web", "command": "https://react.dev/reference/react/useState", "description": "Read useState API docs" }. PREFER browse_web over fetch_url for real websites.
- **fetch_url**: ONLY use for a URL that contains live data specific to THIS project — e.g. a deployed API endpoint, a specific GitHub issue/PR on the user's own repo, a concrete error tracking URL. FORBIDDEN domains (never fetch): yarnpkg.com, npmjs.com, nodejs.org, vitejs.dev, reactjs.org, react.dev, electronjs.org, tauri.app, raw.githubusercontent.com, docs.rs, crates.io, developer.apple.com, developer.mozilla.org, stackoverflow.com, and any docs.* subdomain. If you need framework knowledge, the model already has it — do NOT fetch it.
- IMPORTANT: run_command is ONLY for actual shell commands (npm, node, git, cargo, etc.). If the task is about searching or looking something up on the internet, use web_search or fetch_url instead. A natural-language phrase is NOT a shell command.
- path is required for file actions (relative to project root)
- **CRITICAL — NO file-reading steps**: All project files are already provided in "File contents" above. The coder has full access to those contents. NEVER generate a step whose purpose is to read a file (no cat, head, tail, or any command that just reads a project file). NEVER use a file:// URL as a command — that is not a valid shell command and will always fail. Read the file from the context above instead.
- **CRITICAL — NO generic documentation fetching**: NEVER add a fetch_url or web_search step to read the README, docs, or changelog of a framework/library (Electron, React, Vite, Node, esbuild, yarn, npm, etc.) as a diagnostic step. If you see an error about a missing package or wrong platform, fix it directly with a run_command (e.g. "npm install PACKAGE" or "rm -rf node_modules && npm install") — do NOT look up documentation for it. The model already knows how to fix common errors.
- **macOS ARM64 npm installs — CRITICAL**: This machine is Apple Silicon (arm64). npm has TWO bugs you must work around:
  (A) Optional arm64 native binaries (rollup, rolldown, esbuild) are silently skipped, causing "Cannot find native binding" crashes.
  (B) package-lock.json often has x64 binaries locked in — npm reads the lockfile and tries to install the locked x64 package even with --omit=optional, causing EBADPLATFORM.
  Fix BOTH by ALWAYS using "--no-package-lock --omit=optional --ignore-optional" on EVERY npm install step. "--no-package-lock" bypasses the stale lockfile entirely so npm re-resolves for arm64 fresh.
  FLAG SPELLING — CRITICAL: The flag is "--omit=optional" (equals sign). NEVER write "--omit-optional" (hyphen) or "--omit optional" (space) — those are invalid and npm ignores them silently.
  ALWAYS structure npm installs as TWO consecutive run_command steps:
  1. "npm install PACKAGE --no-package-lock --omit=optional --ignore-optional"
  2. "find node_modules -maxdepth 3 -type d -name '*darwin-x64*' | xargs rm -rf 2>/dev/null || true"
  Step 2 removes ALL x64 native bindings dynamically — no hardcoded package names. Do NOT list specific package names like @rolldown/binding-darwin-x64.
  CRITICAL: Use --no-save for any arm64 binary you install. --save-optional writes them into package.json and causes FUTURE installs to fail again.
- **Playwright in user projects**: If the project's task requires Playwright (e.g. scraping, E2E testing), install with THREE steps: (1) "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright @playwright/test --no-package-lock --omit=optional --ignore-optional" then (2) "find node_modules -maxdepth 3 -type d -name '*darwin-x64*' | xargs rm -rf 2>/dev/null || true" then (3) "npx playwright install chromium". Do NOT use browse_web for project-level scraping — that is for the agent's own research only.
- **Running scripts**: NEVER use bare \`node\` to run a \`.ts\` or \`.tsx\` file — Node.js does not natively support TypeScript. Use \`npx tsx FILE\` instead (it transpiles on-the-fly). NEVER use ts-node — tsx is always preferred and always available via npx without any install. For \`.js\` / \`.mjs\` files, \`node FILE\` is fine. For Python: \`python3 FILE\`. For Rust: \`cargo run\`. Always match the runner to the file's language.
- **Global installs**: NEVER use \`npm install -g TOOL\` — use \`npx TOOL\` to run one-off tools without global installation.
- DO generate run_command steps that explore system paths OUTSIDE the project (e.g. find ~/.cargo, rustc --version, node --version, schema inspection, registry paths) when that information is genuinely needed and is not in the file tree. Only include run_command steps that either (a) change something (npm install, cargo build, etc.) or (b) discover system/external information not in the provided file tree.
- command is required for run_command actions (and path should be omitted)
- diff is required for edit_file actions — show the specific lines changing
- diff is NOT needed for create_file or delete_file
- Order steps logically (create before edit, install before use)
- Keep plans small: prefer 1-3 steps per plan; at most 8 steps. One focused change per step.
- PREFER MODULAR FILES: Split features across multiple small files (one component per file, one utility per file). Never put an entire page with all its sub-components in a single file. Create separate files for components, hooks, utils, and styles, then import them. This keeps each file focused and preserves context window budget for the coding model.
- CRITICAL: File paths MUST exactly match the paths listed in the project context / file tree. If files are inside a subdirectory (e.g. "website/src/App.jsx"), you MUST include that prefix. Never guess paths — use the actual paths provided.
- CRITICAL: Do NOT create a new project directory. Do NOT use "cd ${projectName}" in any run_command — the cwd is already "${projectName}". Using "cd ${projectName} && ..." fails with "No such file or directory". All paths are relative to the project root.
- For edit_file, the "before" diff should reflect what actually exists in the file
- Dev server steps (e.g. \`npm run dev\`, \`vite\`, \`next dev\`) are fine and will be started in the background automatically — include them when the user wants to run the project.

Project context:
${projectContext}
${envInfo ? `\n${formatEnvForPrompt(envInfo)}` : ''}
${installHistory ? `\n${installHistory}` : ''}
${agentMemory ? `\n${agentMemory}` : ''}
REMINDER: The project directory is "${projectName}". Do NOT invent names like "codescout-landing" or "my-project". All paths are relative to "${projectName}".
Respond with ONLY the JSON object. No markdown. No explanation. No "Commands to Run". JUST the JSON.`;
}

function flattenFiles(nodes: FileNode[], result: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push(node);
    }
    if (node.children) {
      flattenFiles(node.children, result);
    }
  }
  return result;
}

// ─── JSON Extraction ─────────────────────────────────────────────────────────

function extractJSON(text: string): string | null {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const raw = fenceMatch ? fenceMatch[1].trim() : text;

  // Try to find raw JSON object
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0].trim();
  }

  // If no closing brace found, the response may be truncated — try to repair
  const openMatch = raw.match(/\{[\s\S]*/);
  if (openMatch) {
    return repairTruncatedJSON(openMatch[0].trim());
  }

  return null;
}

/**
 * Attempts to close unclosed braces/brackets in truncated JSON.
 * This handles the common case where the AI model's response is cut off mid-stream.
 */
function repairTruncatedJSON(json: string): string {
  // Remove any trailing partial key/value (e.g. `"desc` or `,"desc":`)
  let repaired = json.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, '');
  // Also trim trailing comma
  repaired = repaired.replace(/,\s*$/, '');

  // Count unclosed braces and brackets
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  // Close any unclosed structures
  while (brackets > 0) { repaired += ']'; brackets--; }
  while (braces > 0) { repaired += '}'; braces--; }

  return repaired;
}

/** Normalise a model-emitted file path to a consistent relative form.
 *  - Converts backslashes to forward slashes
 *  - Strips any leading slash so paths are always project-root-relative
 */
function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '');
}

function validatePlan(data: unknown): Plan | null {
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;
  if (typeof obj.summary !== 'string') return null;
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) return null;

  const validActions = ['create_file', 'edit_file', 'delete_file', 'run_command', 'web_search', 'fetch_url', 'browse_web'];

  const steps: PlanStep[] = [];
  for (const step of obj.steps) {
    if (!step || typeof step !== 'object') continue;
    const s = step as Record<string, unknown>;

    const action = s.action as string;
    if (!validActions.includes(action)) continue;

    const planStep: PlanStep = {
      id: crypto.randomUUID(),
      action: action as PlanStep['action'],
      description: (s.description as string) || 'No description',
      status: 'pending',
    };

    if (action === 'run_command' || action === 'web_search' || action === 'fetch_url' || action === 'browse_web') {
      planStep.command = (s.command as string) || '';
      if (action === 'browse_web' && s.browseActions) {
        (planStep as unknown as Record<string, unknown>).browseActions = s.browseActions;
      }

      // Hard-block fetch_url steps aimed at generic documentation sites.
      // The model is trained on this content — fetching it wastes a step and
      // context window space without providing any project-specific value.
      if (action === 'fetch_url') {
        const BLOCKED_DOC_DOMAINS = [
          'yarnpkg.com', 'npmjs.com', 'nodejs.org', 'vitejs.dev',
          'reactjs.org', 'react.dev', 'electronjs.org', 'tauri.app',
          'raw.githubusercontent.com', 'docs.rs', 'crates.io',
          'developer.apple.com', 'developer.mozilla.org',
          'stackoverflow.com', 'github.com/electron', 'github.com/vitejs',
          'esbuild.github.io', 'webpack.js.org', 'babeljs.io',
        ];
        try {
          const host = new URL(planStep.command).hostname.replace(/^www\./, '');
          if (BLOCKED_DOC_DOMAINS.some(d => host === d || host.endsWith('.' + d))) {
            // Silently drop this step — it adds no value
            continue;
          }
        } catch { /* not a valid URL — let it through */ }
      }
    } else {
      planStep.path = normalizePath((s.path as string) || '');
    }

    if (action === 'edit_file' && s.diff && typeof s.diff === 'object') {
      const diff = s.diff as Record<string, unknown>;
      planStep.diff = {
        before: (diff.before as string) || '',
        after: (diff.after as string) || '',
      };
    }

    steps.push(planStep);
  }

  if (steps.length === 0) return null;

  const validationCommand =
    typeof obj.validationCommand === 'string' && obj.validationCommand.trim()
      ? obj.validationCommand.trim()
      : undefined;

  return {
    id: crypto.randomUUID(),
    summary: obj.summary as string,
    steps,
    status: 'pending',
    validationCommand,
  };
}

// ─── Plan Generation ─────────────────────────────────────────────────────────

/** Structured project identity — parsed from .codescout/project.json or memory */
export interface ProjectIdentity {
  framework: string;
  packageManager: string;
  language: string;
  styling?: string;
  entryPoints?: string[];
  runCommands?: Record<string, string>;
  /** True when the project already has source files — do NOT scaffold */
  hasExistingProject: boolean;
}

export interface GeneratePlanOptions {
  userRequest: string;
  files: FileNode[];
  projectName: string;
  modelId: string;
  provider: ModelProvider;
  endpoint?: string;
  apiKey?: string;
  skillMd?: string;
  /** Structured project data — injected as explicit fields the LLM cannot miss. */
  projectIdentity?: ProjectIdentity;
  /** When true, \`run_command\` plan steps execute in the Tauri desktop app. */
  shellCapable?: boolean;
  /** Latest user turn images (Plan mode) — same multimodal path as chat. */
  userImages?: ChatImagePart[];
  /** Probed runtime environment — injected into the system prompt so the AI picks the right tools. */
  envInfo?: EnvironmentInfo;
  /** Past install history from .codescout/installs.json — tells the planner what previously failed/succeeded */
  installHistory?: string;
  /** Agent memory prompt — what the agent has learned about this project */
  agentMemory?: string;
  onStatus?: (status: string) => void;
  onTokens?: (usage: TokenUsage) => void;
  /** When aborted, the promise rejects with AbortError. */
  signal?: AbortSignal;
}

export function generatePlan(options: GeneratePlanOptions): Promise<Plan> {
  const {
    userRequest,
    files,
    projectName,
    modelId,
    provider,
    endpoint,
    apiKey,
    skillMd,
    projectIdentity,
    shellCapable = false,
    userImages,
    envInfo,
    installHistory,
    agentMemory,
    onStatus,
    onTokens,
    signal,
  } = options;

  return new Promise((resolve, reject) => {
    const userContent: ModelRequestMessage['content'] =
      userImages?.length
        ? [
            { type: 'text', text: userRequest.trim() || '(see images)' },
            ...userImages.map(img => ({
              type: 'image' as const,
              mediaType: img.mediaType,
              dataBase64: img.dataBase64,
            })),
          ]
        : userRequest;

    const systemPrompt = buildSystemPrompt(files, projectName, skillMd, shellCapable, envInfo, projectIdentity, installHistory, agentMemory);
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ];

    // Rough prompt size estimate for the activity feed
    const promptChars = typeof systemPrompt === 'string' ? systemPrompt.length : 0;
    const promptTokenEst = Math.round(promptChars / 4);
    onStatus?.(`Sending · ~${promptTokenEst.toLocaleString()} token prompt`);

    let fullResponse = '';
    let charsReceived = 0;
    let firstChunkAt = 0;
    let firstChunk = true;
    let receivedRealUsage = false;

    const { endpoint: resolvedEndpoint, apiKey: resolvedApiKey } = useModelStore
      .getState()
      .resolveModelRequestFieldsForProvider(provider, { endpoint, apiKey });

    const onTokensWrapped: typeof onTokens = onTokens
      ? (usage) => {
          if (usage.inputTokens > 0 || usage.outputTokens > 0) {
            receivedRealUsage = true;
          }
          onTokens(usage);
        }
      : undefined;

    // Transition to "Waiting" after a brief delay — the model needs time
    // to process the prompt before it starts streaming back tokens.
    const waitingTimer = setTimeout(() => {
      onStatus?.('Waiting for response…');
    }, 1500);

    callModel(
      { messages, modelId, provider, endpoint: resolvedEndpoint, apiKey: resolvedApiKey, signal },
      // onChunk — stream progress
      (chunk) => {
        fullResponse += chunk;
        charsReceived += chunk.length;
        if (firstChunk) {
          firstChunk = false;
          firstChunkAt = Date.now();
          clearTimeout(waitingTimer);
          onStatus?.('Receiving · first token');
        } else {
          const approxTokens = Math.ceil(charsReceived / 4);
          const elapsedSec = (Date.now() - firstChunkAt) / 1000;
          const tokPerSec = elapsedSec > 0.5
            ? Math.round(approxTokens / elapsedSec)
            : null;

          // Count distinct steps detected so far (look for "title" fields in partial JSON)
          const stepTitles = [...fullResponse.matchAll(/"title"\s*:\s*"([^"]{3,60})"/g)]
            .map(m => m[1]);

          let status = `Receiving · ~${approxTokens.toLocaleString()} tokens`;
          if (tokPerSec !== null) status += ` · ${tokPerSec} tok/s`;
          if (stepTitles.length > 0) {
            status += ` · ${stepTitles.length} step${stepTitles.length !== 1 ? 's' : ''} found`;
          }
          onStatus?.(status);
        }
      },
      // onDone — parse
      (finalText) => {
        onStatus?.('Parsing plan...');

        // Emit estimated token counts if the provider didn't include usage in the stream.
        if (!receivedRealUsage && onTokens) {
          const inEst = messages.reduce((n, m) => {
            const text = typeof m.content === 'string' ? m.content : '';
            return n + Math.max(1, Math.ceil(text.length / 4));
          }, 0);
          const outEst = Math.max(1, Math.ceil(finalText.length / 4));
          onTokens({ inputTokens: inEst, outputTokens: outEst });
        }

        const jsonStr = extractJSON(finalText);
        if (!jsonStr) {
          reject(new Error('The AI response did not contain a valid plan. The model may need a different prompt or configuration.'));
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          reject(new Error('The AI returned an incomplete response. Try again or use a model with a larger context window.'));
          return;
        }

        const plan = validatePlan(parsed);
        if (!plan) {
          reject(new Error('Plan validation failed. Parsed data does not match expected schema.'));
          return;
        }

        onStatus?.(`Plan ready · ${plan.steps.length} steps`);
        resolve(plan);
      },
      // onError
      (error) => {
        reject(error);
      },
      // onTokens
      onTokensWrapped,
    );
  });
}

// ─── Fallback Mock Plan ──────────────────────────────────────────────────────

export function generateMockPlan(
  userRequest: string,
  projectIdentity?: ProjectIdentity,
  files?: FileNode[],
): Plan {
  const lowerReq = userRequest.toLowerCase();
  const steps: PlanStep[] = [];

  // ── Determine file extension from project identity ──
  const lang = projectIdentity?.language?.toLowerCase() ?? '';
  const isTS = lang.includes('typescript');
  const jsxExt = isTS ? '.tsx' : '.jsx';
  const jsExt = isTS ? '.ts' : '.js';
  const cssExt = '.css';

  // ── Detect file tree prefix for nested projects ──
  const flat = files ? flattenFiles(files) : [];
  const projectPrefix = detectMockPlanPrefix(flat);

  // ── Sanitise a component name from the request ──
  // Be very conservative: only grab 1-3 clean words, strip punctuation
  const componentName = extractComponentName(userRequest);
  const componentFileName = `${componentName}${jsxExt}`;

  // ── Detect existing entry points ──
  const entryPoints = projectIdentity?.entryPoints ?? [];
  const appFile = entryPoints.find(e => /App\.(jsx?|tsx?)$/.test(e))
    ?? flat.find(f => /App\.(jsx?|tsx?)$/.test(f.name))?.path
    ?? `${projectPrefix}src/App${jsxExt}`;

  // ── Build the plan steps ──

  // Step 1: Create component
  steps.push({
    id: crypto.randomUUID(),
    action: 'create_file',
    path: `${projectPrefix}src/components/${componentFileName}`,
    description: `Create ${componentName} component`,
    status: 'pending',
  });

  // Step 2: Create page wrapper if user asked for a page/route
  if (lowerReq.includes('page') || lowerReq.includes('route') || lowerReq.includes('landing')) {
    steps.push({
      id: crypto.randomUUID(),
      action: 'create_file',
      path: `${projectPrefix}src/pages/${componentFileName}`,
      description: `Create ${componentName} page wrapper`,
      status: 'pending',
    });
  }

  // Step 3: Edit App entry to import the new component
  steps.push({
    id: crypto.randomUUID(),
    action: 'edit_file',
    path: appFile,
    description: `Import and render ${componentName} in App`,
    status: 'pending',
    diff: {
      before: '',
      after: `import ${componentName} from './components/${componentName}';\n`,
    },
  });

  // Step 4: CSS if user mentioned styles/CSS/theme/design
  if (lowerReq.includes('style') || lowerReq.includes('css') || lowerReq.includes('theme') || lowerReq.includes('design')) {
    const cssPath = flat.find(f => f.name === 'index.css')?.path
      ?? `${projectPrefix}src/index${cssExt}`;
    steps.push({
      id: crypto.randomUUID(),
      action: 'edit_file',
      path: cssPath,
      description: 'Update styles for new component',
      status: 'pending',
      diff: { before: '', after: '/* new styles */\n' },
    });
  }

  // Step 5: npm install ONLY if user specifically requested a library
  if (lowerReq.includes('install ') || lowerReq.includes('add ')) {
    const libMatch = userRequest.match(/(?:install|add)\s+([\w@/-]+(?:\s+[\w@/-]+)*)/i);
    if (libMatch) {
      const pm = projectIdentity?.packageManager ?? 'npm';
      steps.push({
        id: crypto.randomUUID(),
        action: 'run_command',
        command: `${pm} install ${libMatch[1]}`,
        description: `Install requested dependencies`,
        status: 'pending',
      });
    }
  }

  // ── Determine validation command ──
  const buildScript = projectIdentity?.runCommands?.build;
  const validationCommand = buildScript ? `npm run build` : undefined;

  return {
    id: crypto.randomUUID(),
    summary: `Mock plan: ${componentName} (configure a model in Settings for AI-generated plans)`,
    steps,
    status: 'pending',
    validationCommand,
  };
}

/** Extract a clean, safe component name from a user request */
function extractComponentName(userRequest: string): string {
  // Try to find what they want to build/create
  const match = userRequest.match(
    /(?:build|create|add|make)\s+(?:a\s+)?(?:simple\s+)?(?:new\s+)?([\w]+(?:\s+[\w]+)?)\s+(?:landing\s+)?(?:page|component|form|section|view|screen|widget|layout)/i,
  );

  if (match) {
    // Take at most 2 words, strip non-alpha, PascalCase
    const words = match[1]
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w.replace(/[^a-zA-Z]/g, ''))
      .filter(w => w.length > 0)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    if (words.length > 0) return words.join('');
  }

  // Fallback: look for product/brand name in quotes
  const quoted = userRequest.match(/"([A-Za-z]+)"/);
  if (quoted) return quoted[1].charAt(0).toUpperCase() + quoted[1].slice(1);

  // Fallback: if "landing page" is mentioned, use LandingPage
  if (/landing\s*page/i.test(userRequest)) return 'LandingPage';

  return 'Feature';
}

/** Detect project prefix from file paths (for mock plans in nested projects) */
function detectMockPlanPrefix(flat: FileNode[]): string {
  if (flat.length === 0) return '';
  const withSlash = flat.filter(f => {
    if (!f.path.includes('/')) return false;
    return !f.path.split('/')[0].startsWith('.');
  });
  if (withSlash.length === 0) return '';
  const counts = new Map<string, number>();
  for (const f of withSlash) {
    const seg = f.path.split('/')[0];
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  if (counts.size === 1) {
    const [prefix] = counts.keys();
    return `${prefix}/`;
  }
  const total = withSlash.length;
  for (const [seg, count] of counts) {
    if (count / total >= 0.8) return `${seg}/`;
  }
  return '';
}
