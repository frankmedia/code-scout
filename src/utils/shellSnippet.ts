/** Turns fenced shell snippets into a single sh script string (strip prompts, comments, blanks). */
export function normalizeShellSnippet(raw: string): string {
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.replace(/^\$\s+/, '').replace(/^%\s+/, '').replace(/^>\s+/, ''))
    .join('\n')
    .trim();
}
