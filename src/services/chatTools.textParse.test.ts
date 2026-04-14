import { describe, it, expect } from 'vitest';
import { parseTextToolCalls } from './chatTools';

describe('parseTextToolCalls', () => {
  it('parses MiniMax / Kimi XML-style invoke blocks after [tool_calls]', () => {
    const text = `Researching competitors.

[tool_calls] invoke web_search <parameter name="query">Zoopla property search interface filters UX design patterns</parameter> </invoke> </minimax:tool_call>`;

    const out = parseTextToolCalls(text);
    expect(out).not.toBeNull();
    expect(out!.toolCalls).toHaveLength(1);
    expect(out!.toolCalls[0].function.name).toBe('web_search');
    expect(JSON.parse(out!.toolCalls[0].function.arguments)).toEqual({
      query: 'Zoopla property search interface filters UX design patterns',
    });
    expect(out!.cleanText.trim()).toBe('Researching competitors.');
  });

  it('parses multiple invoke blocks in one tail', () => {
    const text = `[tool_calls] invoke web_search <parameter name="query">A</parameter> </invoke> </minimax:tool_call> invoke web_search <parameter name="query">B</parameter> </invoke>`;

    const out = parseTextToolCalls(text);
    expect(out).not.toBeNull();
    expect(out!.toolCalls).toHaveLength(2);
    expect(JSON.parse(out!.toolCalls[0].function.arguments).query).toBe('A');
    expect(JSON.parse(out!.toolCalls[1].function.arguments).query).toBe('B');
  });

  it('still parses JSON-style tool lines when present', () => {
    const text = `Ok.
[tool_calls]
web_search({"query": "test q"})`;

    const out = parseTextToolCalls(text);
    expect(out).not.toBeNull();
    expect(out!.toolCalls).toHaveLength(1);
    expect(out!.toolCalls[0].function.name).toBe('web_search');
    expect(JSON.parse(out!.toolCalls[0].function.arguments).query).toBe('test q');
  });
});
