/**
 * Run: npx vitest run src/utils/nodeErrorDiagnostics.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  buildNodeParseErrorDiagnosticsBlock,
  chatTailSuggestsNodeParseError,
} from './nodeErrorDiagnostics';
import type { ChatMessage } from '@/store/workbenchStore';

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}

describe('nodeErrorDiagnostics', () => {
  it('detects SyntaxError in last user message', () => {
    const messages: ChatMessage[] = [
      msg('assistant', 'ok'),
      msg('user', 'Uncaught Exception:\nSyntaxError: Unexpected token \':\''),
    ];
    expect(chatTailSuggestsNodeParseError(messages)).toBe(true);
  });

  it('detects compileSourceTextModule stack', () => {
    const messages: ChatMessage[] = [
      msg('user', 'at compileSourceTextModule (node:internal/modules/esm/utils:319:16)'),
    ];
    expect(chatTailSuggestsNodeParseError(messages)).toBe(true);
  });

  it('ignores when last user message is unrelated', () => {
    const messages: ChatMessage[] = [
      msg('user', 'add a login button'),
    ];
    expect(chatTailSuggestsNodeParseError(messages)).toBe(false);
  });

  it('buildNodeParseErrorDiagnosticsBlock mentions trace-uncaught and file path', () => {
    const b = buildNodeParseErrorDiagnosticsBlock();
    expect(b).toContain('--trace-uncaught');
    expect(b).toContain('file path');
  });
});
