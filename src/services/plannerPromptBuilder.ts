/**
 * plannerPromptBuilder — system prompt and file context builders for the planner.
 *
 * Extracted from planGenerator.ts so prompt-assembly logic lives in a focused module
 * that small models can read without ingesting JSON extraction, streaming, and plan
 * normalisation logic.  planGenerator.ts re-exports everything from here for backward compat.
 */

import type { FileNode } from '@/store/workbenchStore';
import type { EnvironmentInfo } from './environmentProbe';
import { formatEnvForPrompt } from './environmentProbe';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── File context constants ────────────────────────────────────────────────────

const MAX_FILE_INLINE_CHARS = 6_000;
const MAX_FILE_SIZE_TO_INLINE = 80_000;
const ALWAYS_INLINE_NAMES = new Set([
  'package.json', 'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
  'tsconfig.json', 'tsconfig.app.json', 'index.html', 'cargo.toml',
  'go.mod', 'pyproject.toml', '.env', '.env.example',
]);

// ─── File helpers ──────────────────────────────────────────────────────────────

export function flattenFiles(nodes: FileNode[], result: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    if (node.type === 'file') result.push(node);
    if (node.children) flattenFiles(node.children, result);
  }
  return result;
}

export function shouldInlineFile(node: FileNode): boolean {
  if (!node.content) return false;
  if (node.content.length > MAX_FILE_SIZE_TO_INLINE) return false;
  const name = node.name.toLowerCase();
  if (ALWAYS_INLINE_NAMES.has(name)) return true;
  const ext = name.split('.').pop() ?? '';
  return ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'css', 'html', 'md'].includes(ext);
}

export function buildFileContext(files: FileNode[]): string {
  const flat = flattenFiles(files);
  const filePaths = flat.map(f => f.path);

  const inlined: string[] = [];
  let totalChars = 0;
  const sorted = [...flat].sort((a, b) => {
    const aP = ALWAYS_INLINE_NAMES.has(a.name.toLowerCase()) ? 0 : 1;
    const bP = ALWAYS_INLINE_NAMES.has(b.name.toLowerCase()) ? 0 : 1;
    return aP - bP;
  });
  for (const f of sorted) {
    if (!shouldInlineFile(f)) continue;
    if (totalChars > 40_000) break;
    const snippet = f.content!.slice(0, MAX_FILE_INLINE_CHARS);
    const truncated = f.content!.length > MAX_FILE_INLINE_CHARS ? '\n... (truncated)' : '';
    inlined.push(`### ${f.path}\n\`\`\`\n${snippet}${truncated}\n\`\`\``);
    totalChars += snippet.length;
  }

  const pathList =
    filePaths.slice(0, 120).join('\n') +
    (filePaths.length > 120 ? `\n... and ${filePaths.length - 120} more` : '');

  return inlined.length > 0
    ? `## File tree\n${pathList}\n\n## File contents\n${inlined.join('\n\n')}`
    : `## File tree\n${pathList}`;
}

export function buildProjectIdentityBlock(
  id: ProjectIdentity,
  projectName?: string,
  scaffoldPrompt?: string,
): string {
  const lines: string[] = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    '║                    PROJECT IDENTITY                         ║',
    '║  These are FACTS about the current project. Obey them.     ║',
    '╚══════════════════════════════════════════════════════════════╝',
  ];
  if (projectName) {
    lines.push(`PROJECT_DIRECTORY: ${projectName}`);
    lines.push(
      `IMPORTANT: The project directory is "${projectName}". All file paths are relative to THIS directory. Do NOT create a new subdirectory or rename the project.`,
    );
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
    lines.push(
      'PREFER: Write ALL files directly with create_file — do NOT use scaffolding commands (npm create vite, npx create-react-app) which are fragile and often fail.',
    );
    if (scaffoldPrompt) {
      lines.push('');
      lines.push(scaffoldPrompt);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ─── System prompt builder ────────────────────────────────────────────────────

export function buildSystemPrompt(
  files: FileNode[],
  projectName: string,
  skillMd: string | undefined,
  shellCapable: boolean,
  envInfo?: EnvironmentInfo,
  projectIdentity?: ProjectIdentity,
  installHistory?: string,
  agentMemory?: string,
  terminalContext?: string,
  /** Pre-resolved scaffold reference from scaffoldRegistry — injected for empty projects only */
  scaffoldPrompt?: string,
): string {
  const fileContext = buildFileContext(files);
  const projectContext = skillMd
    ? `${skillMd}${skillMd.includes('## File tree') ? '' : `\n\n${fileContext}`}`
    : `Project: "${projectName}"\n${fileContext}`;

  const flat = flattenFiles(files);
  const hasSourceFiles = flat.some(f => /\.(jsx?|tsx?|py|rs|go|rb|php|cs|java)$/.test(f.path));
  const hasPackageJson = flat.some(f => f.name === 'package.json');
  const isEmpty = projectIdentity
    ? !projectIdentity.hasExistingProject
    : flat.length === 0 || (!hasSourceFiles && !hasPackageJson);

  const scaffoldRules = isEmpty
    ? `IMPORTANT — Empty/new project: The user just created this project directory ("${projectName}"). It is already the current working directory. DO NOT run scaffolding commands (npm create vite, npx create-react-app, etc.) — they are fragile, can create nested directories, and often fail. WRITE ALL FILES DIRECTLY with create_file. Then run the install command. The PROJECT IDENTITY block contains the exact scaffold reference with all file contents.`
    : `This project already has files. Do NOT re-initialize or scaffold from scratch. Do NOT run npm create, npx create-vite, or any scaffolding command. Work with the existing file structure. Edit existing files or add new files alongside them.`;

  const shellRules = shellCapable
    ? `Execution context: **Desktop app** — \`run_command\` steps run on the user's machine with \`sh -c\` in the opened project directory. Prefer file edits when that is enough; use \`run_command\` for installs, builds, codegen, etc. Do **not** use \`rm -rf node_modules\` unless the user explicitly asked for a clean reinstall — it breaks validation until \`npm install\` finishes. For Node/Vite repos, set validationCommand to **npm run build** (not bare \`vite build\`). ${scaffoldRules}`
    : `Execution context: **Browser** — \`run_command\` steps cannot run here; they will be skipped at execution. Avoid \`run_command\` unless unavoidable; prefer \`create_file\` / \`edit_file\` / \`delete_file\`. For npm/git/etc., describe what the user should run locally or tell them to repeat the task in the desktop app. ${scaffoldRules}`;

  const identityBlock = projectIdentity
    ? buildProjectIdentityBlock(projectIdentity, projectName, scaffoldPrompt)
    : (scaffoldPrompt ? `\n## Project Scaffold Reference\n${scaffoldPrompt}\n` : '');

  return `You are Code Scout AI, an expert coding assistant in **Agent** mode. You decide how to help.

**When to reply in plain text:** If the user is chatting, greeting, asking a quick question, or the message is not a concrete coding task for this project, answer naturally in normal prose (markdown allowed). Do not wrap that reply in JSON.

**When to output a plan:** If they want changes to the codebase, a feature, a fix, a refactor, installs, builds, a code review, an action plan, scraping/crawling checks, or anything that should run as automated steps, respond with **only** a single JSON object — no markdown fences, no text before or after the object. The app will parse and run it. Use the **full conversation** in the user/assistant messages below plus project context so follow-ups (e.g. "yes it's in the project") stay tied to the original goal (e.g. Rightmove scraper).

**Plan JSON rules (when you choose a plan):**
- NEVER start a run_command with "cd ${projectName}" or "cd ./${projectName}" — the shell already runs with "${projectName}" as the current working directory. Writing "cd ${projectName} && ..." will fail with "No such file or directory".
- NEVER invent a new project/directory name. The project is "${projectName}".
- If you need to run a command inside a SUBDIRECTORY (e.g. a nested package), use "cd subdirname && command". Never cd into the top-level project name itself.

The JSON object must follow this exact schema:
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
- **UI copy — NEVER** mention user approval, "approve", "no files will be modified until…", or waiting for confirmation in \`summary\`, any \`description\`, or \`assumptions\`. Code Scout runs plans automatically in chat; those phrases are false and confuse users.
- validationCommand is optional. If the plan modifies source code that should compile, set it to the project's build command (e.g. "npm run build", "cargo build"). If the plan only edits config/data files, runs scripts, or does non-compilation tasks, OMIT validationCommand entirely — the agent will validate each step on its own. NEVER force a build validation on a plan that doesn't change compilable source code.
- action must be one of: create_file, edit_file, delete_file, run_command, web_search, fetch_url, browse_web
- **web_search**: Search the internet for docs, examples, APIs, or solutions. Put a natural-language search query in the "command" field (e.g. "react router v6 tutorial", "tailwind CSS grid examples"). The search results are automatically fed to subsequent coding steps. ALWAYS use web_search (NOT run_command) when the user asks to search, look up, research, or find information online. NEVER put a plain-English query in run_command — that will fail.
- **Competitive / product UX research**: If the user asks to mirror, analyze, or take inspiration from **real products or listing sites** (e.g. Rightmove, Zillow, Airbnb, Zoopla, Redfin, property portals, booking UIs), add **one or more web_search steps before coding** with specific queries (e.g. "Rightmove property listing page UX", "Zillow search filters UI patterns"). Do not skip this — the post-run summary only has evidence if these steps exist. Generic framework docs are not a substitute for competitor UX research when the user explicitly asked for it.
- **browse_web**: Navigate a real headless browser to a URL and extract fully-rendered page content. Use this for documentation sites, GitHub pages, SPAs, or any site that needs JavaScript to render. Put the URL in the "command" field. Supports optional "browseActions" array: [{"type":"click","selector":"..."}, {"type":"wait","ms":1000}]. Example: { "action": "browse_web", "command": "https://react.dev/reference/react/useState", "description": "Read useState API docs" }. PREFER browse_web over fetch_url for real websites.
- **fetch_url**: ONLY use for a URL that contains live data specific to THIS project — e.g. a deployed API endpoint, a specific GitHub issue/PR on the user's own repo, a concrete error tracking URL. FORBIDDEN domains (never fetch): yarnpkg.com, npmjs.com, nodejs.org, vitejs.dev, reactjs.org, react.dev, electronjs.org, tauri.app, raw.githubusercontent.com, docs.rs, crates.io, developer.apple.com, developer.mozilla.org, stackoverflow.com, and any docs.* subdomain. If you need framework knowledge, the model already has it — do NOT fetch it.
- IMPORTANT: run_command is ONLY for actual shell commands (npm, node, git, cargo, etc.). If the task is about searching or looking something up on the internet, use web_search or fetch_url instead. A natural-language phrase is NOT a shell command.
- In every step **description** field, prefix with what the user will see: \`[Local · shell]\` for run_command, \`[Local · files]\` for create/edit/delete_file, \`[Internet · search]\` for web_search, \`[Internet · HTTP fetch]\` for fetch_url, \`[Internet · headless browser]\` for browse_web — so the user always knows if a step uses the network or only their machine.
- path is required for file actions (relative to project root)
- **CRITICAL — NO file-reading steps**: All project files are already provided in "File contents" above. The coder has full access to those contents. NEVER generate a step whose purpose is to read or "inspect" a project file via the shell: **forbidden** commands include \`cat\`, \`head\`, \`tail\`, \`less\`, \`more\`, \`type\`, \`grep\`/\`rg\` when the only goal is to view project source (e.g. \`cat src/App.tsx\`). Diagnosing a blank screen = **edit_file** / **create_file** fixes using the file contents already in context, plus at most **one** \`run_command\` to run the dev server or build — NOT a chain of cat/grep steps. NEVER use a file:// URL as a command. Read from the context above instead.
- **CRITICAL — NO generic documentation fetching**: NEVER add a fetch_url or web_search step to read the README, docs, or changelog of a framework/library (Electron, React, Vite, Node, esbuild, yarn, npm, etc.) as a diagnostic step. If you see an error about a missing package or wrong platform, fix it directly with a run_command (e.g. "npm install PACKAGE" or "rm -rf node_modules && npm install") — do NOT look up documentation for it. The model already knows how to fix common errors.
- **Shell grammar — rm**: \`rm -rf\` takes **space-separated** paths. NEVER use commas: \`rm -rf node_modules,package-lock.json\` tries to delete one file literally named \`node_modules,package-lock.json\` and FAILS. Correct: \`rm -rf node_modules\` then \`rm -f package-lock.json\`, OR one line: \`rm -rf node_modules && rm -f package-lock.json\`.
- **Shell grammar — mv**: \`mv SRC DEST\` is a **move, not a copy** — it removes SRC automatically. NEVER write \`mv SRC DEST && rm SRC\` — the \`rm\` always fails (exit 1) because mv already deleted the source, causing the agent to think the move failed and loop endlessly. Just use \`mv src/file dest/\`.
- **macOS ARM64 / native npm bindings**: Apple Silicon often hits wrong-arch optional deps or stale lockfiles. Strategy (pick ONE coherent path — do not mix conflicting flags):
  - **Default install**: \`npm install\` or \`npm install PKG\` — lets npm fetch correct arm64 optional deps (needed for lightningcss, rollup, playwright driver, etc.).
  - **If EBADPLATFORM / stale lock x64**: clean reinstall: \`rm -rf node_modules && rm -f package-lock.json && npm install\` (or pnpm/yarn equivalent). Then \`npm rebuild\` for the failing native package if still broken.
  - **Do NOT** put \`--omit=optional\` on installs that must pull **Playwright browsers**, **lightningcss**, **esbuild**, or **rollup** native bindings — optional deps are exactly how those resolve on the right arch. Reserve \`--omit=optional\` only for narrow recovery when the error log proves optional deps pulled the wrong platform.
  FLAG SPELLING: valid flag is \`--omit=optional\` (equals). Never \`--omit-optional\`.
  If you strip x64 dirs after install: \`find node_modules -maxdepth 4 -type d -name '*darwin-x64*' 2>/dev/null | xargs rm -rf 2>/dev/null || true\` then reinstall — do not repeat the same install line that failed.
- **Playwright** (scraping / E2E): (1) \`npm install -D playwright @playwright/test\` (normal install; no PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD unless bandwidth is critical). (2) \`npx playwright install chromium\` (required — downloads browser binaries; not optional npm tarballs). On CI, \`npx playwright install --with-deps chromium\` on Linux only. **Never** combine \`--omit=optional\` with Playwright install unless you immediately run step (2) and a normal reinstall if browsers are missing.
- **Cheerio**: \`npm install cheerio\` — modern cheerio ships TypeScript types; skip \`@types/cheerio\` unless the project pins cheerio 0.x.
- **Running scripts**: NEVER use bare \`node\` to run a \`.ts\` or \`.tsx\` file — Node.js does not natively support TypeScript. Use \`npx tsx FILE\` instead (it transpiles on-the-fly). NEVER use ts-node — tsx is always preferred and always available via npx without any install. For \`.js\` / \`.mjs\` files, \`node FILE\` is fine. For Python: \`python3 FILE\`. For Rust: \`cargo run\`. Always match the runner to the file's language.
- **Global installs**: NEVER use \`npm install -g TOOL\` — use \`npx TOOL\` to run one-off tools without global installation.
- DO generate run_command steps that explore system paths OUTSIDE the project (e.g. find ~/.cargo, rustc --version, node --version, schema inspection, registry paths) when that information is genuinely needed and is not in the file tree. Only include run_command steps that either (a) change something (npm install, cargo build, etc.) or (b) discover system/external information not in the provided file tree.
- command is required for run_command actions (and path should be omitted)
- diff is required for edit_file actions — show the specific lines changing
- diff is NOT needed for create_file or delete_file
- Order steps logically (create before edit, install before use)
- **Component ordering (CRITICAL for React/Next.js projects)**: Always create reusable components BEFORE pages that import them. For example, if \`app/page.tsx\` imports \`@/components/Header\`, create \`components/Header.tsx\` FIRST, then create \`app/page.tsx\`. Never create a page file that imports a component that doesn't exist yet.
- **Import/filename casing (CRITICAL)**: Import paths MUST exactly match the actual filename casing. If file is \`Header.tsx\`, import as \`@/components/Header\`. If file is \`header.tsx\`, import as \`@/components/header\`. Mismatched casing causes "Module not found" on Linux and Webpack casing warnings on macOS. Pick one convention and use it consistently across ALL component files and imports.
- **Export consistency (CRITICAL for Next.js)**: For React components in \`components/\` folders, ALWAYS use named exports: \`export function Header() { ... }\` or \`export const Header = () => { ... }\`. Then import with \`import { Header } from '@/components/Header'\`. This prevents default/named export mismatch errors. For Next.js page/layout files in \`app/\`, use \`export default function\` as required by Next.js.
- Keep plans small: prefer 1-3 steps per plan; at most 8 steps. One focused change per step.
- PREFER MODULAR FILES (CRITICAL for small LLM compatibility): Split features across multiple small files. Keep every file under 200 lines. Never put multiple components, hooks, or utilities in the same file. One concern per file: one component, one hook, one utility module. Create separate files for components, hooks, utils, types, and styles, then import them. Files over 200 lines must be split. This keeps each file focused, reduces context usage, and prevents write errors from small models that struggle with large outputs.
- **CSS/Tailwind v4 setup (CRITICAL):** Tailwind CSS v4 uses a NEW configuration system. The old PostCSS plugin \`tailwindcss: {}\` NO LONGER WORKS.
  - For Vite projects: use \`@tailwindcss/vite\` plugin in vite.config.ts
  - For Next.js projects: use \`@tailwindcss/postcss\` in postcss.config.mjs: \`plugins: { "@tailwindcss/postcss": {} }\`
  - CSS file: use \`@import "tailwindcss";\` (NOT the old \`@tailwind base; @tailwind components; @tailwind utilities;\`)
  - No \`tailwind.config.js\` is required for basic usage in v4
  NEVER use the old v3 pattern \`plugins: { tailwindcss: {}, autoprefixer: {} }\` — it causes "The PostCSS plugin has moved to a separate package" errors.
- CRITICAL: File paths MUST exactly match the paths listed in the project context / file tree. If files are inside a subdirectory (e.g. "website/src/App.jsx"), you MUST include that prefix. Never guess paths — use the actual paths provided.
- CRITICAL: Do NOT create a new project directory. Do NOT use "cd ${projectName}" in any run_command — the cwd is already "${projectName}". Using "cd ${projectName} && ..." fails with "No such file or directory". All paths are relative to the project root.
- For edit_file, the "before" diff should reflect what actually exists in the file
- Dev server steps (e.g. \`npm run dev\`, \`vite\`, \`next dev\`) are fine and will be started in the background automatically — include them when the user wants to run the project.
${identityBlock}
Project context:
${projectContext}
${envInfo ? `\n${formatEnvForPrompt(envInfo)}` : ''}
${installHistory ? `\n${installHistory}` : ''}
${agentMemory ? `\n${agentMemory}` : ''}
${terminalContext ? `\n## Recent workbench terminal (user ran these in the Terminal panel — respect installs/builds/errors shown here)\n${terminalContext}\n` : ''}
REMINDER: The project directory is "${projectName}". Do NOT invent names like "codescout-landing" or "my-project". All paths are relative to "${projectName}".
Either answer in plain text (conversation) OR output only the plan JSON — pick one, matching the user's intent.`;
}
