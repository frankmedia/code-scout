/** User clearly wants executable work / a plan, not small talk. */
export function userMessageLooksLikePlanWork(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return false;
  return (
    /\b(action\s+plan|execution\s+plan|create\s+(a\s+)?plan|make\s+(a\s+)?plan|step[s]?\s+to|roadmap)\b/.test(t) ||
    /\b(review\s+(my\s+)?code|audit\s+(the\s+)?code|refactor|implement|fix\s+(the|this|my)|debug|broken|doesn'?t\s+work|not\s+working)\b/.test(t) ||
    /\b(scrape|scraper|crawler|rightmove|ensure\s+.*\s+works?|verify\s+that|add\s+(a\s+)?feature)\b/.test(t) ||
    /\b(run\s+tests?|npm\s+run|build\s+and|write\s+(the\s+)?code)\b/.test(t) ||
    /\b(change|update|write)\b.*\b(file|files|import|exports?|code|entrypoint)\b/.test(t)
  );
}
