/**
 * Tail of workbench terminal lines for LLM system prompts.
 * Keeps the model aware of installs, builds, and errors the user ran manually.
 * No markdown code fences — output may contain backticks.
 */
export function formatTerminalContextForAgent(lines: string[], maxChars = 6500): string {
  if (!lines.length) return '';
  const joined = lines.join('\n').trim();
  if (!joined) return '';
  if (joined.length <= maxChars) return joined;
  const tail = joined.slice(joined.length - maxChars);
  return `…(truncated earlier output)\n${tail}`;
}
