/**
 * Strip legacy “wait for approval” / model-hallucinated disclaimers from plan UI copy.
 * Code Scout runs plans automatically in chat flow — these lines are never true here.
 */
export function sanitizePlanUiText(text: string): string {
  const lines = text.split('\n');
  const out = lines.filter((line) => {
    const t = line.trim().toLowerCase();
    if (t.includes('no files will be modified until')) return false;
    if (/\buntil you approve\b/.test(t)) return false;
    if (/nothing runs until you (approve|click)/.test(t)) return false;
    if (/will not (run|execute|modify) until you approve/.test(t)) return false;
    return true;
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function sanitizePlanStepDescription(desc: string): string {
  let s = desc;
  s = s.replace(/\bno files will be modified until you approve\.?\s*/gi, '');
  s = s.replace(/\buntil you approve\.?\s*/gi, '');
  return s.replace(/\s{2,}/g, ' ').trim();
}
