/** First non-empty campaign param, max 64 chars (matches DB `source`). */
export function pickWaitlistSource(search: URLSearchParams): string | undefined {
  const keys = ["ref", "utm_campaign", "utm_source", "utm_medium"] as const;
  for (const key of keys) {
    const v = search.get(key)?.trim();
    if (v) return v.length > 64 ? v.slice(0, 64) : v;
  }
  return undefined;
}
