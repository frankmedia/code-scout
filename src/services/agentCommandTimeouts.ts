import { useModelStore } from '@/store/modelStore';
import {
  DEFAULT_FOREGROUND_COMMAND_TIMEOUT_MS,
  DEFAULT_LONG_RUNNING_COMMAND_TIMEOUT_MS,
  DEFAULT_SEARCH_COMMAND_TIMEOUT_MS,
} from '@/config/runtimeTimeoutDefaults';

export function getForegroundCommandTimeoutMs(command: string): number {
  const trimmedCmd = command.trim();
  const {
    agentCommandTimeoutMs = DEFAULT_FOREGROUND_COMMAND_TIMEOUT_MS,
    agentSearchCommandTimeoutMs = DEFAULT_SEARCH_COMMAND_TIMEOUT_MS,
    agentLongRunningCommandTimeoutMs = DEFAULT_LONG_RUNNING_COMMAND_TIMEOUT_MS,
  } = useModelStore.getState();

  const isRepoSearch =
    /^(?:git\s+grep|grep|rg|ack|ag)\b/i.test(trimmedCmd) &&
    !/^(npm|yarn|pnpm|bun|cargo|go|python|pip)\b/i.test(trimmedCmd);
  if (isRepoSearch) return agentSearchCommandTimeoutMs;

  const isLongRunning =
    /^(?:npm|npx|pnpm|yarn|bun|cargo|go|mvn|gradle|dotnet|swift|xcodebuild)\b/i.test(trimmedCmd) ||
    /\b(?:build|install|lint|test|check|typecheck|compile|export|verify)\b/i.test(trimmedCmd) ||
    /\b(?:next|vite|webpack|rollup|tsc|jest|vitest|eslint|playwright)\b/i.test(trimmedCmd);
  return isLongRunning ? agentLongRunningCommandTimeoutMs : agentCommandTimeoutMs;
}

export function getLongRunningCommandTimeoutMs(): number {
  return useModelStore.getState().agentLongRunningCommandTimeoutMs || DEFAULT_LONG_RUNNING_COMMAND_TIMEOUT_MS;
}
