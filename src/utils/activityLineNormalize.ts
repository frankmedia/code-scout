/**
 * Strip leading emoji / pasted prefix so activity-line regexes still match.
 * Shared by AgentActivityFeed classification and inferWorkbenchAgentRole.
 */
const ACTIVITY_LINE_MARKERS = [
  'Orchestrator ·',
  'Coder ·',
  'Round ',
  'Coder r',
  'Delegate to coder',
  '→ ',
  'Verifying',
  'Verify ·',
  'FINISH_TASK',
  'Installing',
  'Auto-install',
  '$ ',
] as const;

export function normalizeActivityLine(text: string): string {
  let t = text.trim();
  let best = -1;
  for (const m of ACTIVITY_LINE_MARKERS) {
    const i = t.indexOf(m);
    if (i > 0 && (best < 0 || i < best)) best = i;
  }
  if (best > 0) t = t.slice(best);
  return t;
}

export type FormatActivityLogOptions = {
  includeHeader?: boolean;
  /** Appended as the last line (e.g. in-flight status). */
  currentStatus?: string | null;
};

/** Plain-text export for support / debugging; one normalized line per row. */
export function formatActivityLogForExport(
  lines: string[],
  opts?: FormatActivityLogOptions,
): string {
  const normalized = lines.map((line) => normalizeActivityLine(line.trim()));
  const withStatus =
    opts?.currentStatus != null && String(opts.currentStatus).trim() !== ''
      ? [...normalized, normalizeActivityLine(String(opts.currentStatus).trim())]
      : normalized;
  const body = withStatus.join('\n');
  if (opts?.includeHeader) {
    return ['Code Scout — agent activity log', `Exported: ${new Date().toISOString()}`, '---', body].join(
      '\n',
    );
  }
  return body;
}
