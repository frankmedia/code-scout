/**
 * Detect Node / ESM parse errors in the user's last message and supply a standard
 * diagnostics block for the agent context (file:line discovery).
 */
import type { ChatMessage } from '@/store/workbenchStore';

const PATTERNS = [
  /SyntaxError:\s*Unexpected token/i,
  /SyntaxError:/i,
  /compileSourceTextModule/i,
  /ModuleLoader\.moduleStrategy/i,
  /Unexpected token\s*['']?:['']?/i,
];

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      return m.content;
    }
  }
  return '';
}

/** True if the most recent user message looks like a Node module parse failure. */
export function chatTailSuggestsNodeParseError(messages: ChatMessage[]): boolean {
  const text = lastUserText(messages);
  if (!text || text.length > 16_000) return false;
  return PATTERNS.some(re => re.test(text));
}

/**
 * Appended as an extra user turn so the orchestrator/coder sees concrete next steps.
 * Keep ASCII-only for widest model compatibility.
 */
export function buildNodeParseErrorDiagnosticsBlock(): string {
  return [
    '[Code Scout · diagnostics for Node / ESM parse errors]',
    '',
    'The user message looks like `SyntaxError: Unexpected token` or similar from Node\'s ESM loader.',
    'Internal frames (compileSourceTextModule, ModuleLoader, etc.) do not include the project file path.',
    '',
    'Do this next:',
    '1. Run the same entry the user runs, with a full stack, e.g. `node --trace-uncaught path/to/entry.mjs` or `node --enable-source-maps ...` so the stack shows a **file path under the project**.',
    '2. Open that file at the reported line. Typical causes: TypeScript-only syntax in a `.js` file under `"type":"module"`, a bad merge (stray `:`), or invalid JSON imported as JS.',
    '3. If the path is still unclear, use `search_files` / `grep` for recent edits or run `node --check file.js` on suspect files.',
    '',
    'Do not guess random files; locate the parse error site first, then fix minimal syntax.',
  ].join('\n');
}
