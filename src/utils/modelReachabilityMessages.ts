import { OPENAI_CHAT_COMPLETIONS_HINT } from './openAiModelCompat';

/**
 * Turn raw provider/network errors into actionable copy for the chat UI.
 */
export function formatPlanningFailureMessage(raw: string): string {
  const trimmed = raw.trim() || 'Unknown error';
  const block = trimmed.length > 1800 ? `${trimmed.slice(0, 1800)}…` : trimmed;

  // If the error already embeds the model reply (new format), don't double-wrap
  const hasEmbeddedReply = trimmed.includes('Model replied:');

  const lines: string[] = [
    '**Could not generate a plan** — the orchestrator could not get a valid response from the AI service.',
    '',
    ...(hasEmbeddedReply
      ? [block]
      : ['```', block, '```']),
  ];

  if (/\b401\b|unauthorized|invalid.?api|incorrect api key|wrong api key/i.test(trimmed)) {
    lines.push(
      '',
      '**What to check:** Open **Settings → Models**, verify the **API key** for this provider (OpenAI keys start with `sk-…`). For OpenAI, base URL should usually be empty or `https://api.openai.com/v1`.',
    );
  } else if (/\b403\b|forbidden/i.test(trimmed)) {
    lines.push('', '**What to check:** Key may lack permission for this model, or organization billing/policy blocked the request.');
  } else if (/\b429\b|rate.?limit|too many requests/i.test(trimmed)) {
    lines.push('', '**What to check:** Rate limit — wait briefly, try another model, or upgrade quota.');
  } else if (/v1\/responses|only supported in v1\/responses|not in v1\/chat\/completions/i.test(trimmed)) {
    lines.push('', `**What to check:** ${OPENAI_CHAT_COMPLETIONS_HINT}`);
  } else if (/failed to fetch|networkerror|econnrefused|enotfound|socket|timed out|timeout|load failed/i.test(trimmed)) {
    lines.push(
      '',
      '**What to check:** Network — VPN, firewall, proxy, or wrong **custom endpoint** in Settings. If you use a local gateway (LM Studio, Ollama), confirm it is running.',
    );
  } else if (/\b404\b|not found|model not found|does not exist|no such model/i.test(trimmed)) {
    // Detect ChatGPT web-UI alias being used against the real API
    const chatgptAlias = /chatgpt-4o-latest|chatgpt-4o|chatgpt-4-turbo/i.test(trimmed);
    if (chatgptAlias) {
      lines.push(
        '',
        '**What to check:** `chatgpt-4o-latest` is a ChatGPT web alias — it doesn\'t exist on the OpenAI API. ' +
        'Open **Settings → Models**, find this model, and change the model ID to `gpt-4o` (or `gpt-4o-mini` for a faster/cheaper variant).',
      );
    } else {
      lines.push('', '**What to check:** The **model id** may be wrong for this provider, or the endpoint path is incorrect.');
    }
  } else if (/\b500\b|502\b|503\b|504\b|internal server|bad gateway|service unavailable/i.test(trimmed)) {
    lines.push('', '**What to check:** Provider outage or overloaded — retry later or switch provider/model.');
  }

  return lines.join('\n');
}
