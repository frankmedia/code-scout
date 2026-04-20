/**
 * agentExecutor.ts
 *
 * Main plan execution loop. All helper functions (step executors, code generation,
 * validation, web research, port management, path resolution) have been extracted
 * into focused modules. This file contains only `executePlan()` and the imports /
 * re-exports needed to keep consumers working.
 */

import { useWorkbenchStore, PlanStep, Plan } from '@/store/workbenchStore';
import { useModelStore, ModelConfig } from '@/store/modelStore';
import { verifyStep, VerificationInput, VerificationResult } from './verifierAgent';
import {
  resolveProjectRoot,
  formatValidationFailure,
  ValidationRunResult,
  collectProjectConfigHints,
  normalizeValidationCommand,
} from './validationRunner';
import { requestRepairFix, RepairFix } from './repairAgent';
import type { EnvironmentInfo } from './environmentProbe';
import {
  createRepairLedger,
  nextRepairAction,
  recordAttempt,
  withProjectLock,
  formatLedgerForPrompt,
  bumpBudget,
  computeProgress,
} from './dependencyRepairEngine';
import { classifyFailure } from './validationRunner';
import type { RepairAttempt } from './repairTypes';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import { flattenAllFilesCapped, raceWithTimeout, normalizePlanPaths } from './agentExecutorUtils';
import {
  isInstallCommand,
  buildInstallRecord,
  recordInstall,
  buildInstallContext,
} from './installTracker';

// ─── Imports from decomposed modules ────────────────────────────────────────

import {
  type ExecutionCallbacks,
  type RepairProjectContext,
  setProjectContext,
  setProjectIdentity,
  setEnvInfo,
  setSkillMd,
  setInstallHistoryForCoder,
  setScaffoldHint,
  resetAgentState,
  getProjectContext,
  getEnvInfo,
  getWebResearchContext,
  getWebResearchContextLength,
  addWebResearchContext,
} from './agentExecutorContext';

import { executeStepAction } from './agentExecutorSteps';
import { executeWebSearch } from './agentExecutorWebResearch';
import {
  runPostStepValidation,
  classifyValidationFailure,
  buildStopDiagnostic,
  syntaxPreCheck,
  applyRepairFix,
} from './agentExecutorValidation';

import type { ProjectIdentity } from './planGenerator';
import { buildScaffoldHint } from './scaffoldRegistry';
import { executeRepairCommand } from './agentExecutorPort';

// ─── Re-exports (keep consumers working) ───────────────────────────────────
// These symbols were previously exported from this file. Consumers still
// import them from '@/services/agentExecutor', so we re-export here.

export type { ExecutionCallbacks } from './agentExecutorContext';
export { getWebResearchContext } from './agentExecutorContext';
export { resolveFilePath, isBackgroundCommand, normalizeCommandPaths } from './pathResolution';
export { detectDevServerPort, freePortIfOccupied, BACKGROUND_SETTLE_MS_EXPORT } from './agentExecutorPort';
export { syntaxPreCheck } from './agentExecutorValidation';
export { classifyValidationFailure } from './agentExecutorValidation';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Hard cap on repair attempts per step.
 * The repair engine enforces this via RepairEngineConfig.maxTotalAttempts;
 * this export is kept for backwards-compat with UI components.
 */
export const MAX_REPAIR_ATTEMPTS_PER_STEP = 20;

/**
 * @deprecated -- repair sequencing is now driven by dependencyRepairEngine.
 * Kept to avoid breaking imports in UI components.
 */
export const ORCHESTRATOR_HELP_THRESHOLD = 3;

/**
 * @deprecated -- escalation is now driven by dependencyRepairEngine's escalate_to_user action.
 * Kept to avoid breaking imports in UI components.
 */
export const ESCALATION_THRESHOLD = 3;

// ─── Main Executor ───────────────────────────────────────────────────────────

export async function executePlan(
  plan: Plan,
  callbacks: ExecutionCallbacks,
  coderModelOverride?: ModelConfig,
  verifierModelOverride?: ModelConfig,
  /** Structured project info -- set once so all step executors + repair agent can use it */
  projectIdentity?: ProjectIdentity,
  /** System environment -- set once so the coder + repair agents know OS/arch */
  envInfo?: EnvironmentInfo,
): Promise<void> {
  const store = useWorkbenchStore.getState();
  const modelStore = useModelStore.getState();

  const coderModel = coderModelOverride ?? modelStore.getModelForRole('coder');
  const verifierModel = verifierModelOverride ?? modelStore.getModelForRole('tester');

  // Reset all module-level state from the previous plan execution
  resetAgentState();

  // Set module-level project context for code generation + repair
  if (projectIdentity) {
    setProjectIdentity(projectIdentity);
    setProjectContext({
      framework: projectIdentity.framework,
      packageManager: projectIdentity.packageManager,
      language: projectIdentity.language,
      entryPoints: projectIdentity.entryPoints,
      runCommands: projectIdentity.runCommands,
      os: envInfo?.os ?? null,
      arch: envInfo?.arch ?? null,
    });

    // Resolve scaffold hint for empty projects — the coder prompt reads it via
    // getScaffoldHint() in agentExecutorCodeGen and agentToolLoop.
    if (!projectIdentity.hasExistingProject) {
      try {
        const hint = await buildScaffoldHint(projectIdentity.framework, projectIdentity.language);
        if (hint) setScaffoldHint(hint);
      } catch { /* non-fatal — coder will still work without the hint */ }
    }
  }
  // Set module-level env info so coder + repair agents know the system
  setEnvInfo(envInfo ?? useWorkbenchStore.getState().envInfo ?? undefined);

  // Pull skillMd from project memory store so coder has project conventions
  try {
    const { useProjectMemoryStore } = await import('@/store/projectMemoryStore');
    setSkillMd(useProjectMemoryStore.getState().getMemory(store.projectName)?.skillMd || undefined);
  } catch { /* non-fatal */ }

  // Pull install history so coder knows what to avoid repeating (bounded -- disk read must not block forever)
  setInstallHistoryForCoder(undefined);
  if (store.projectPath) {
    try {
      const root = resolveProjectRoot(store.projectPath, store.files);
      if (root) {
        const INSTALL_CTX_MS = 6_000;
        setInstallHistoryForCoder(
          (await raceWithTimeout(buildInstallContext(root), INSTALL_CTX_MS, undefined)) || undefined,
        );
      }
    } catch { /* non-fatal */ }
  }

  store.clearHistory();

  // Let the UI paint "executing" before any heavy synchronous work (large file trees).
  callbacks.onLog('Plan engine: preparing...', 'info');
  await new Promise<void>(r => setTimeout(r, 0));

  // Pre-process plan paths -- fix hallucinated paths before execution begins
  const allFiles = flattenAllFilesCapped(store.files, (m) => callbacks.onLog(m, 'warning'));
  normalizePlanPaths(plan, (p) => store.getFileContent(p), allFiles, callbacks.onLog);

  callbacks.onTerminal('--- Executing plan: ' + plan.summary + ' ---');
  callbacks.onLog('Plan execution started', 'info');
  if (plan.validationCommand) {
    callbacks.onLog(`Validation after edits: ${plan.validationCommand}`, 'info');
  }

  let stoppedEarly = false;
  let stopReason = '';
  let userCancelled = false;
  const sig = callbacks.signal;

  const abortIfNeeded = (label: string): boolean => {
    if (!sig?.aborted) return false;
    stopReason = label;
    stoppedEarly = true;
    userCancelled = true;
    callbacks.onPlanStoppedEarly?.(label);
    return true;
  };

  stepLoop: for (const [stepIndex, step] of plan.steps.entries()) {
    if (abortIfNeeded('Cancelled by user')) break stepLoop;

    useWorkbenchStore.getState().updatePlanStep(step.id, {
      stopDiagnostic: undefined,
      lastValidationError: undefined,
      repairAttemptCount: 0,
    });

    callbacks.onStepStart(step);
    callbacks.onLog(`Step: ${step.description}`, 'info');

    const storeBefore = useWorkbenchStore.getState();
    const contentBefore = step.path ? storeBefore.getFileContent(step.path) : undefined;
    const fileExistsBefore = step.path ? contentBefore !== undefined : false;

    let stepThrowError: string | null = null;
    try {
      await executeStepAction(step, coderModel, callbacks);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        abortIfNeeded('Cancelled by user');
        break stepLoop;
      }
      const stepError = err instanceof Error ? err.message : 'Unknown error';

      // EBADPLATFORM errors on npm/yarn/pnpm installs: don't kill the plan -- convert
      // to a synthetic validation failure so the repair loop can try LLM-guided fixes
      // (e.g. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, different package versions, etc.).
      const isInstallCmd = /^(npm|npx|yarn|pnpm|bun)\s+(?:install|add|i)\b/i.test((step.command ?? '').trim());
      if (step.action === 'run_command' && isInstallCmd && /ebadplatform/i.test(stepError)) {
        callbacks.onLog(
          `EBADPLATFORM auto-fix exhausted -- converting to repair loop for LLM-guided recovery`,
          'warning',
        );
        callbacks.onTerminal(`\u2699 Entering repair loop for arm64 platform fix...`);
        stepThrowError = stepError;
        // Fall through to validation block below with a synthetic failure
      } else if (
        step.action === 'run_command' &&
        /timed out|Command timed out/i.test(stepError) &&
        /^(?:git\s+grep|grep|rg|ack|ag)\b/i.test((step.command ?? '').trim())
      ) {
        // Read-only search over the repo -- do not enter the heavy repair engine; user only waits longer.
        callbacks.onLog(`Search command hit the time limit -- stopping the plan. ${stepError.slice(0, 200)}`, 'error');
        callbacks.onTerminal(`! ${stepError}`);
        callbacks.onStepError(step, stepError);
        stoppedEarly = true;
        stopReason = stepError;
        break stepLoop;
      } else if (step.action === 'run_command') {
        // All run_command failures enter the repair loop -- the agent decides
        // whether to retry, search the web, try different flags, or move on.
        // The repair engine's progress-gated persistence handles everything.
        callbacks.onLog(
          `Command failed -- entering repair loop: ${stepError.slice(0, 200)}`,
          'warning',
        );
        callbacks.onTerminal(`\u2699 Command failed -- repair loop will try to fix it...`);
        stepThrowError = stepError;
      }

      if (!stepThrowError) {
        callbacks.onStepError(step, stepError);
        callbacks.onLog(`Error in step "${step.description}": ${stepError}`, 'error');
        callbacks.onTerminal(`! Error: ${stepError}`);
        stoppedEarly = true;
        stopReason = stepError;
        break stepLoop;
      }
    }

    const storeAfter = useWorkbenchStore.getState();
    const contentAfter = step.path ? storeAfter.getFileContent(step.path) : undefined;
    const fileExistsAfter = step.path ? contentAfter !== undefined : true;

    // Web search / fetch / browse steps don't modify files -- auto-pass verification
    if (step.action === 'web_search' || step.action === 'fetch_url' || step.action === 'browse_web') {
      callbacks.onStepDone(step);
      continue;
    }

    const isLastStep = stepIndex === plan.steps.length - 1;

    // The agent decides whether a project build is relevant -- not the plan.
    //
    // A project-wide build/lint validation is only useful when ALL of these hold:
    //   1. This is the last step (earlier steps haven't set up the full environment)
    //   2. The plan contains at least one source-code change (edit_file/create_file
    //      on a compilable file) -- if the plan only runs commands or edits configs,
    //      the build was never the goal
    //   3. The step itself is a run_command -- file-edit steps are validated by the
    //      step verifier (did the content change?), not by a build
    //
    // This means the agent never needs the user to specify a validation command.
    // It runs one when it makes sense, and skips it otherwise.
    const planTouchesSourceCode = plan.steps.some(s =>
      (s.action === 'edit_file' || s.action === 'create_file') &&
      s.path &&
      /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|php|cs|java|swift|kt|c|cpp|h|hpp|vue|svelte)$/i.test(s.path),
    );
    const stepIsRunCommand = step.action === 'run_command';

    const skipProjectBuild = !isLastStep || !stepIsRunCommand || !planTouchesSourceCode;

    // If executeStepAction threw an EBADPLATFORM error, inject it as a synthetic
    // validation failure so the repair loop can try LLM-guided recovery strategies.
    let validation: ValidationRunResult;
    if (stepThrowError) {
      validation = {
        pass: false,
        command: step.command ?? '',
        stdout: '',
        stderr: stepThrowError,
        skipped: false,
      };
      useWorkbenchStore.getState().updatePlanStep(step.id, {
        lastValidationCommand: step.command ?? '',
        lastValidationError: stepThrowError.slice(0, 500),
      });
    } else {
      const verInput: VerificationInput = {
        step,
        fileExistsBefore,
        fileExistsAfter,
        contentBefore,
        contentAfter,
        errorOutput: undefined,
      };
      const verActId = callbacks.onActivity?.('verifying', `Verifying: ${step.description.slice(0, 60)}`);
      const verification = await verifyStep(verInput, verifierModel);
      if (verActId) callbacks.onActivityComplete?.(verActId);
      callbacks.onLog(
        `Verified step: ${verification.result} -- ${verification.summary}`,
        verification.result === 'pass' ? 'success' : verification.result === 'fail' ? 'error' : 'warning',
      );

      // Only run the full project build on the last step.
      // Intermediate steps cannot reliably pass a build until the entire plan is applied.
      validation = await runPostStepValidation(plan, verification, skipProjectBuild);
    }

    useWorkbenchStore.getState().updatePlanStep(step.id, {
      lastValidationCommand: validation.command,
      lastValidationError: validation.pass ? undefined : formatValidationFailure(validation).slice(0, 500),
    });

    if (validation.pass) {
      callbacks.onStepDone(step);
      continue;
    }

    // -- Syntax pre-check before full build -----------------------------------
    // Catch the most common model-caused file corruptions cheaply, before
    // spending 30-120s on a real build.
    if (step.path && !validation.pass) {
      const fileContent = useWorkbenchStore.getState().getFileContent(step.path);
      if (fileContent !== undefined) {
        const syntaxProblems = syntaxPreCheck(fileContent, step.path);
        if (syntaxProblems.length > 0) {
          const syntaxError = `Syntax pre-check failed in ${step.path}:\n${syntaxProblems.map(p => `  \u2022 ${p}`).join('\n')}`;
          callbacks.onLog(syntaxError, 'error');
          callbacks.onTerminal(`! ${syntaxProblems[0]}`);
          // Inject a synthetic validation result so the repair agent gets a
          // tight, precise error instead of a full build dump.
          validation = {
            pass: false,
            command: `syntax-check ${step.path}`,
            stdout: '',
            stderr: syntaxError,
            skipped: false,
          };
          useWorkbenchStore.getState().updatePlanStep(step.id, {
            lastValidationCommand: `syntax-check ${step.path}`,
            lastValidationError: syntaxError.slice(0, 500),
          });
        }
      }
    }

    // -- Ledger-based repair loop ---------------------------------------------
    // One control loop, one decision maker (dependencyRepairEngine).
    // No parallel retry cascades, no overlapping mutation layers.
    const ledger = createRepairLedger(step.id, { maxTotalAttempts: MAX_REPAIR_ATTEMPTS_PER_STEP, wallClockBudgetMs: 900_000 });
    let attempt = 0;
    let repeatedError = false;
    let skipCurrentStep = false;

    // Detect package manager and arch for the repair engine context.
    // Derive PM from the actual validation command -- more reliable than stored project context
    // because the user may have changed the command since the project was last scanned.
    const { projectPath: repairPP, files: repairFiles } = useWorkbenchStore.getState();
    const _projectContext = getProjectContext();
    const _cmdForPm = validation.command ?? step.command ?? '';
    const _detectedPm = ((): import('./repairTypes').PackageManager => {
      if (/^npm[\s/]/.test(_cmdForPm)) return 'npm';
      if (/^pnpm[\s/]/.test(_cmdForPm)) return 'pnpm';
      if (/^yarn[\s/]/.test(_cmdForPm)) return 'yarn';
      if (/^bun[\s/]/.test(_cmdForPm)) return 'bun';
      return _projectContext?.packageManager ?? null;
    })();
    let repairContext = {
      packageManager: _detectedPm,
      arch: _projectContext?.arch ?? null,
      os: _projectContext?.os ?? null,
      lockfilePresent: repairFiles.some(f =>
        f.name === 'package-lock.json' || f.name === 'bun.lockb' || f.name === 'yarn.lock' ||
        f.path?.endsWith('/package-lock.json') || f.path?.endsWith('/bun.lockb') || f.path?.endsWith('/yarn.lock')
      ),
      projectPath: repairPP ?? '',
      originalCommand:
        normalizeValidationCommand(
          step.command ?? validation.command ?? '',
          (p) => useWorkbenchStore.getState().getFileContent(p),
          repairFiles,
        ) || step.command || validation.command,
    };
    // Track search source count for progress scoring
    let _searchSourcesAdded = 0;

    while (!validation.pass) {
      if (abortIfNeeded('Cancelled by user')) break stepLoop;

      _searchSourcesAdded = 0; // reset per iteration; escalate_to_search will set it

      // Classify the current failure
      const fingerprint = classifyFailure(
        validation.stdout,
        validation.stderr,
        validation.pass ? 0 : 1,
        { packageManager: repairContext.packageManager, arch: repairContext.arch, os: repairContext.os },
      );

      // Ask the repair engine what to do next
      const action = nextRepairAction(ledger, fingerprint, repairContext);

      switch (action.kind) {
        case 'stop': {
          callbacks.onLog(`Repair engine stopped: ${action.reason}`, 'error');
          callbacks.onTerminal(`! ${action.reason}`);
          repeatedError = action.reason.includes('persisted');
          break;
        }

        case 'run_command': {
          attempt += 1;
          useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'repairing', repairAttemptCount: attempt });
          callbacks.onRepairStart?.(step, attempt);
          callbacks.onLog(`Repair [${action.strategyId}]: ${action.command}`, 'info');
          callbacks.onTerminal(`$ ${action.command}`);

          const cmdActId = callbacks.onActivity?.('repairing', `[${action.strategyId}]: ${action.command.slice(0, 60)}`, '');

          let repairResult: Awaited<ReturnType<typeof executeRepairCommand>> | null = null;
          try {
            // Prepend env vars as KEY=VALUE prefix because shell commands are passed as a single string.
            const envPrefix = action.env
              ? Object.entries(action.env).map(([k, v]) => `${k}=${v}`).join(' ') + ' '
              : '';
            const fullCmd = envPrefix + action.command;
            await withProjectLock(repairContext.projectPath, async () => {
              repairResult = await executeRepairCommand(fullCmd, repairContext.projectPath);
            });
          } catch (e) {
            repairResult = { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
          }

          if (cmdActId) callbacks.onActivityComplete?.(cmdActId);

          const repairExitCode = repairResult?.code ?? null;
          const progress = computeProgress(ledger, fingerprint, action.strategyFamily, 0);
          const repairAttempt: RepairAttempt = {
            timestamp: new Date().toISOString(),
            strategyId: action.strategyId,
            command: action.command,
            packageManager: repairContext.packageManager,
            result: repairExitCode === 0 ? 'success' : 'failed',
            fingerprint,
            exitCode: repairExitCode,
            errorSnippet: (repairResult?.stderr ?? '').slice(-500),
            strategyFamily: action.strategyFamily,
            progressScore: progress.score,
          };
          recordAttempt(ledger, repairAttempt);

          if (repairExitCode === 0) {
            // Re-validate after successful repair command
            const rv = await runPostStepValidation(
              plan,
              { result: 'pass', summary: 'repair command succeeded' } satisfies VerificationResult,
              skipProjectBuild,
            );
            validation = rv;
            useWorkbenchStore.getState().updatePlanStep(step.id, {
              lastValidationCommand: validation.command,
              lastValidationError: validation.pass ? undefined : formatValidationFailure(validation).slice(0, 500),
            });
            callbacks.onRepairDone?.(step, attempt, validation.pass);
          } else {
            // Exit 127 = command not found, 126 = permission denied -- infrastructure failure.
            // The repair command itself wasn't found, so the PM is wrong. Correct it to npm.
            if (repairExitCode === 127 || repairExitCode === 126) {
              repairContext = { ...repairContext, packageManager: 'npm' };
              callbacks.onLog(
                `Repair command not found (exit ${repairExitCode}) -- package manager unavailable, switching to npm`,
                'warning',
              );
              // Record the missing binary to agent memory so future plans avoid it
              const missingBinMatch = action.command.trim().match(/^(\S+)/);
              const missingBin = missingBinMatch?.[1] ?? action.command.trim().slice(0, 40);
              try {
                useAgentMemoryStore.getState().addMemory({
                  projectName: useWorkbenchStore.getState().projectName,
                  category: 'error',
                  title: `Missing binary: ${missingBin} (exit ${repairExitCode})`,
                  content: `Command "${action.command}" failed with exit ${repairExitCode} (command not found). Binary "${missingBin}" is not installed or not in PATH. Do not use this binary directly; install it first or use an alternative (e.g., npx ${missingBin}).`,
                  tags: ['missing_binary', missingBin, `exit_${repairExitCode}`],
                  outcome: 'failure',
                });
              } catch { /* non-fatal */ }
            } else {
              callbacks.onLog(
                `Repair command failed (exit ${repairExitCode ?? '?'}): ${(repairResult?.stderr ?? '').slice(0, 200)}`,
                'warning',
              );
            }

            // Record failed repair install commands to installs.json so buildInstallContext
            // populates its KNOWN FAILURES section -- the LLM sees what already failed
            if (isInstallCommand(action.command)) {
              try {
                const { projectPath, files } = useWorkbenchStore.getState();
                const { resolveEffectiveRoot } = await import('@/services/memoryManager');
                const root = projectPath ? resolveEffectiveRoot(projectPath, files) : '';
                if (root) {
                  const failRecord = buildInstallRecord(
                    action.command,
                    repairExitCode ?? 1,
                    repairResult?.stdout ?? '',
                    (repairResult?.stderr ?? '').slice(-500),
                    0,
                    step.id,
                    '',
                  );
                  recordInstall(failRecord, root).catch(() => {});
                }
              } catch { /* non-fatal */ }
            }

            callbacks.onRepairDone?.(step, attempt, false);
          }
          continue;
        }

        case 'escalate_to_search': {
          // Engine decided we need web evidence before more attempts.
          if (!coderModel) {
            callbacks.onLog('No coder model configured -- skipping web search.', 'warning');
            ledger.webSearchDone = true; // mark done so we don't loop forever
            continue;
          }
          const searchQuery = action.query;
          callbacks.onLog(`Searching the web: "${searchQuery.slice(0, 120)}"`, 'info');
          callbacks.onTerminal(`\uD83D\uDD0D Researching: "${searchQuery.slice(0, 120)}"`);
          const searchActId = callbacks.onActivity?.('researching', `Searching: "${searchQuery.slice(0, 80)}"`, 'Evidence gathering');
          try {
            const searchStep: PlanStep = {
              ...step,
              id: `search_repair_${step.id}`,
              action: 'web_search',
              command: searchQuery,
              description: `Research: ${searchQuery.slice(0, 80)}`,
            };
            const prevLen = getWebResearchContext().length;
            await executeWebSearch(searchStep, coderModel, callbacks);
            _searchSourcesAdded = getWebResearchContext().length - prevLen;
          } catch { /* non-fatal */ }
          if (searchActId) callbacks.onActivityComplete?.(searchActId);
          ledger.webSearchDone = true;
          // Reset zero-progress counter -- new evidence was (potentially) gathered
          ledger.zeroProgressRounds = 0;
          continue;
        }

        case 'run_pm_reassessment': {
          // Re-derive PM from the actual validation command (not stored project context).
          callbacks.onLog(`PM reassessment: ${action.reason}`, 'info');
          const cmdForReassess = validation.command ?? step.command ?? '';
          const reassessedPm = ((): import('./repairTypes').PackageManager => {
            if (/^npm[\s/]/.test(cmdForReassess)) return 'npm';
            if (/^pnpm[\s/]/.test(cmdForReassess)) return 'pnpm';
            if (/^yarn[\s/]/.test(cmdForReassess)) return 'yarn';
            if (/^bun[\s/]/.test(cmdForReassess)) return 'bun';
            return 'npm'; // safe default
          })();
          if (reassessedPm !== repairContext.packageManager) {
            callbacks.onLog(`PM reassessment: switching from "${repairContext.packageManager}" to "${reassessedPm}"`, 'warning');
            repairContext = { ...repairContext, packageManager: reassessedPm };
          } else {
            callbacks.onLog(`PM reassessment: "${reassessedPm}" confirmed (no change).`, 'info');
          }
          ledger.pmReassessmentDone = true;
          ledger.zeroProgressRounds = 0;
          continue;
        }

        case 'escalate_to_llm': {
          if (!coderModel) {
            callbacks.onLog('No coder model configured -- cannot auto-repair.', 'warning');
            break;
          }

          attempt += 1;
          useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'repairing', repairAttemptCount: attempt });
          callbacks.onRepairStart?.(step, attempt);

          const repairActId = callbacks.onActivity?.(
            'repairing',
            `LLM repair attempt ${attempt}: ${step.description.slice(0, 50)}`,
            formatValidationFailure(validation).slice(0, 100),
          );

          const st = useWorkbenchStore.getState();
          const repairBaseline = step.path ? st.getFileContent(step.path) : undefined;
          // Don't send the file being edited when the error is a native binding or platform
          // issue -- the file is irrelevant and causes the LLM to edit it instead of reinstalling
          const fileExcerpt =
            step.path && repairBaseline !== undefined &&
            fingerprint.category !== 'missing_native_binding' &&
            fingerprint.category !== 'bad_platform'
              ? { path: step.path, content: repairBaseline }
              : undefined;
          const projectFileHints = collectProjectConfigHints(st.files, st.getFileContent);

          // The repair ledger + past install history + agent memory are passed to the LLM
          // so it cannot repeat strategies that failed now or in previous sessions.
          const ledgerSummary = formatLedgerForPrompt(ledger);
          let installHistoryCtx: string | undefined;
          try {
            installHistoryCtx = await buildInstallContext(repairContext.projectPath);
          } catch { /* non-fatal */ }
          let agentMemoryCtx: string | undefined;
          try {
            agentMemoryCtx = useAgentMemoryStore.getState().buildMemoryPrompt(
              useWorkbenchStore.getState().projectName, 1500,
            ) || undefined;
          } catch { /* non-fatal */ }
          const _envInfo = envInfo;
          const researchContext = [
            ...getWebResearchContext().slice(-5),
            ledgerSummary,
            installHistoryCtx,
          ].filter(Boolean).join('\n\n');

          const fix = await requestRepairFix({
            step,
            attempt,
            maxAttempts: MAX_REPAIR_ATTEMPTS_PER_STEP,
            validation,
            fileExcerpt,
            projectFileHints,
            // Pass the corrected (runtime-derived) package manager, not the stale stored one
            projectContext: { ..._projectContext, packageManager: repairContext.packageManager ?? _projectContext?.packageManager },
            researchContext: researchContext || undefined,
            agentMemory: agentMemoryCtx,
            envInfo: _envInfo,
            userHint: undefined,
            previousAttempts: ledger.attempts.map(a => `[${a.strategyId}] ${a.command.slice(0, 80)} \u2192 ${a.result}`),
            model: coderModel,
            signal: sig,
          });

          if (repairActId) callbacks.onActivityComplete?.(repairActId);

          const llmProgress = computeProgress(ledger, fingerprint, action.strategyFamily, _searchSourcesAdded);
          const llmAttempt: RepairAttempt = {
            timestamp: new Date().toISOString(),
            strategyId: `llm-repair-${attempt}`,
            command: fix
              ? (fix.kind === 'run_command' ? fix.command : `edit_file:${fix.path}`)
              : '(no fix)',
            packageManager: repairContext.packageManager,
            result: 'failed',
            fingerprint,
            exitCode: null,
            errorSnippet: '',
            strategyFamily: action.strategyFamily,
            progressScore: llmProgress.score,
          };

          if (!fix) {
            callbacks.onLog('Repair agent returned no applicable fix -- continuing repair loop for next strategy.', 'warning');
            callbacks.onRepairDone?.(step, attempt, false);
            llmAttempt.errorSnippet = 'LLM returned no fix';
            recordAttempt(ledger, llmAttempt);
            // `continue` not `break` -- a null response is a failed attempt, not a terminal stop.
            // The engine will escalate to search, PM reassessment, or user on the next iteration.
            continue;
          }

          try {
            await applyRepairFix(fix, callbacks);
          } catch (repairErr) {
            const msg = repairErr instanceof Error ? repairErr.message : String(repairErr);
            callbacks.onLog(`Repair failed: ${msg}`, 'error');
            callbacks.onTerminal(`! Repair failed: ${msg}`);
            callbacks.onRepairDone?.(step, attempt, false);
            llmAttempt.errorSnippet = msg.slice(0, 300);
            recordAttempt(ledger, llmAttempt);
            validation = { pass: false, command: validation.command, stdout: '', stderr: msg, skipped: false };
            continue;
          }

          const vAfter = useWorkbenchStore.getState();
          const cAfter = step.path ? vAfter.getFileContent(step.path) : undefined;
          const existsAfter = step.path ? cAfter !== undefined : true;
          const verInput2: VerificationInput = {
            step,
            fileExistsBefore,
            fileExistsAfter: existsAfter,
            contentBefore: repairBaseline,
            contentAfter: cAfter,
            errorOutput: undefined,
          };
          const verification2 = await verifyStep(verInput2, verifierModel);
          validation = await runPostStepValidation(plan, verification2, skipProjectBuild);

          useWorkbenchStore.getState().updatePlanStep(step.id, {
            lastValidationCommand: validation.command,
            lastValidationError: validation.pass ? undefined : formatValidationFailure(validation).slice(0, 500),
          });

          llmAttempt.result = validation.pass ? 'success' : 'failed';
          recordAttempt(ledger, llmAttempt);
          callbacks.onRepairDone?.(step, attempt, validation.pass);
          continue;
        }

        case 'escalate_to_user': {
          // Never block on user input -- auto-continue and expand budget.
          bumpBudget(ledger, 5);
          callbacks.onLog(`Auto-continue after escalation trigger (attempt ${attempt})`, 'warning');
          continue;
        }

        case 'escalate_to_orchestrator': {
          // Coder model failed 3+ times — escalate to orchestrator for a
          // comprehensive replan. Collects ALL errors and generates new steps.
          callbacks.onLog('Coder stuck — escalating to orchestrator for a new strategy', 'warning');
          callbacks.onTerminal('⚙ Escalating to orchestrator for comprehensive fix...');

          const orchModel = useModelStore.getState().getModelForRole('orchestrator');
          if (!orchModel?.enabled) {
            callbacks.onLog('No orchestrator model available — cannot escalate', 'error');
            break;
          }

          // Collect full error context + file content for the failing step
          const allErrors = formatValidationFailure(validation);
          const ws = useWorkbenchStore.getState();
          const projectFiles = flattenAllFilesCapped(
            ws.files,
            (m) => callbacks.onLog(m, 'warning'),
          ).map(f => f.path).join('\n');

          // Include the actual file content so the orchestrator can see wrong imports
          let fileContent = '';
          if (step.path) {
            const content = ws.getFileContent(step.path);
            if (content) fileContent = `\n\nACTUAL FILE CONTENT (${step.path}):\n${content.slice(0, 6000)}`;
          }

          // Include component file listing for import-related errors
          let componentListing = '';
          const allProjectFiles = flattenAllFilesCapped(ws.files, () => {}).map(f => f.path);
          const componentFiles = allProjectFiles
            .filter(p => {
              const normalized = p.replace(/\\/g, '/');
              return /component/i.test(normalized) || /(^|\/)components\//.test(normalized) || /(^|\/)app\//.test(normalized);
            });
          if (componentFiles.length > 0) {
            componentListing = `\n\nCOMPONENT FILES THAT ACTUALLY EXIST:\n${componentFiles.join('\n')}`;
          }

          // Extract "Module not found" targets and identify which are truly missing
          const moduleNotFoundMatches = allErrors.matchAll(/(?:Module not found|Can't resolve)[^\n]*['"]([^'"]+)['"]/gi);
          const missingModules: string[] = [];
          for (const match of moduleNotFoundMatches) {
            const target = match[1];
            // Skip node_modules packages
            if (!target.startsWith('.') && !target.startsWith('@/') && !target.startsWith('~/')) continue;
            // Normalize the import path to a likely file path
            const likelyPaths = [
              target.replace(/^@\//, '').replace(/^~\//, ''),
              target.replace(/^@\//, '').replace(/^~\//, '') + '.tsx',
              target.replace(/^@\//, '').replace(/^~\//, '') + '.ts',
              target.replace(/^@\//, '').replace(/^~\//, '') + '/index.tsx',
            ];
            const exists = likelyPaths.some(lp =>
              allProjectFiles.some(pf => pf.replace(/\\/g, '/').endsWith(lp))
            );
            if (!exists) {
              missingModules.push(target);
            }
          }
          let missingFilesHint = '';
          if (missingModules.length > 0) {
            missingFilesHint = `\n\n⚠️ FILES THAT DO NOT EXIST (must be created with create_file):\n${[...new Set(missingModules)].join('\n')}`;
          }

          try {
            const { requestOrchestratorReplanning } = await import('./repairAgent');
            const newSteps = await requestOrchestratorReplanning({
              step,
              attemptCount: attempt,
              errorSummary: allErrors.slice(0, 4000) + missingFilesHint + fileContent + componentListing,
              attemptHistory: ledger.attempts.map(a =>
                `[${a.strategyId}] ${a.command?.slice(0, 100) ?? 'edit'} → ${a.result}: ${a.errorSnippet?.slice(0, 150) ?? 'ok'}`,
              ),
              model: orchModel,
              signal: callbacks.signal,
              projectFileHints: projectFiles.slice(0, 5000),
              envInfo: getEnvInfo(),
            });

            if (newSteps.length > 0) {
              callbacks.onLog(`Orchestrator proposed ${newSteps.length} fix step(s)`, 'success');
              // Execute each orchestrator-proposed step
              for (const replanStep of newSteps) {
                const fixStep: PlanStep = {
                  id: crypto.randomUUID(),
                  action: replanStep.action,
                  description: replanStep.description,
                  status: 'pending',
                  path: replanStep.path,
                  command: replanStep.command,
                  content: replanStep.content,
                  diff: replanStep.action === 'edit_file'
                    ? { before: replanStep.before ?? '', after: replanStep.after ?? '' }
                    : undefined,
                };
                callbacks.onLog(`Orchestrator fix: ${fixStep.description}`, 'info');
                callbacks.onTerminal(`> Orchestrator fix: ${fixStep.description}`);
                try {
                  await executeStepAction(fixStep, coderModel, callbacks);
                } catch (e) {
                  callbacks.onLog(`Orchestrator fix failed: ${e instanceof Error ? e.message : String(e)}`, 'warning');
                }
              }
              // Re-validate after all orchestrator fixes applied
              attempt++;
              validation = await runPostStepValidation(plan, { stepId: step.id, result: 'pass', summary: '', observedFacts: [], likelyCauses: [], recommendedAction: 'continue' }, false);
              const orchAttempt: RepairAttempt = {
                timestamp: new Date().toISOString(),
                strategyId: 'orchestrator-replan',
                strategyFamily: 'orchestrator_replan',
                command: newSteps.map(s => s.description).join('; '),
                packageManager: repairContext.packageManager,
                result: validation.pass ? 'success' : 'failed',
                errorSnippet: validation.pass ? undefined : formatValidationFailure(validation).slice(0, 500),
                fingerprint,
                progressScore: validation.pass ? 1 : 0,
              };
              recordAttempt(ledger, orchAttempt);
              callbacks.onRepairDone?.(step, attempt, validation.pass);
              continue;
            }
            callbacks.onLog('Orchestrator returned no alternative steps', 'warning');
          } catch (e) {
            callbacks.onLog(`Orchestrator escalation failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
          }
          break;
        }
      }

      // Break out of while if action.kind was 'stop' or LLM returned nothing or escalation
      // (the continue statements above re-enter the loop when we want to keep going)
      break;
    }

    // Clear "repairing" only on success — avoid flashing "running" before we mark the step failed.
    if (validation.pass) {
      useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'running' });
    }

    // If user chose to skip this step, record it and move on
    if (skipCurrentStep) {
      useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'done' });
      useAgentMemoryStore.getState().recordCommandOutcome(
        useWorkbenchStore.getState().projectName,
        step.description,
        false,
        'User skipped this step after repeated repair failures',
      );
      continue;
    }

    if (!validation.pass) {
      useAgentMemoryStore.getState().recordCommandOutcome(
        useWorkbenchStore.getState().projectName,
        step.command ?? step.description,
        false,
        formatValidationFailure(validation).slice(0, 300),
      );

      // Persist the ledger even on failure -- future sessions will know all strategies were exhausted
      if (ledger.attempts.length > 0) {
        const lastFingerprint = ledger.attempts[ledger.attempts.length - 1]?.fingerprint;
        useAgentMemoryStore.getState().addMemory({
          projectName: useWorkbenchStore.getState().projectName,
          category: 'error',
          title: `Repair failed: ${lastFingerprint?.category ?? 'unknown'} -- ${step.description.slice(0, 60)}`,
          content: [
            `Step: ${step.description}`,
            `Error category: ${lastFingerprint?.category ?? 'unknown'}`,
            `Error signature: ${lastFingerprint?.errorSignature ?? 'unknown'}`,
            `All strategies exhausted without success.`,
            '',
            formatLedgerForPrompt(ledger),
          ].join('\n'),
          tags: [
            lastFingerprint?.category ?? 'unknown',
            repairContext.packageManager ?? 'unknown',
            'exhausted',
          ].filter(Boolean),
        });
      }

      const kind = classifyValidationFailure(validation, repeatedError);
      const diagnostic = buildStopDiagnostic(step, validation, attempt, kind);
      useWorkbenchStore.getState().updatePlanStep(step.id, {
        stopDiagnostic: diagnostic,
        stopDiagnosticKind: kind,
        status: 'error',
      });
      callbacks.onStepError(step, diagnostic);
      callbacks.onLog(diagnostic, 'error');
      callbacks.onTerminal(`! ${diagnostic.split('\n')[0]}`);
      stoppedEarly = true;
      stopReason = diagnostic;
      break stepLoop;
    }

    if (attempt > 0) {
      // Find the specific attempt that succeeded so we record WHAT worked, not just that something did
      const winningAttempt = [...ledger.attempts].reverse().find(a => a.result === 'success');
      const winningCmd = winningAttempt?.command ?? step.command ?? step.description;
      const resolution = winningAttempt
        ? `Fixed by [${winningAttempt.strategyId}] (${winningAttempt.strategyFamily}): ${winningCmd.slice(0, 200)}. Category was: ${winningAttempt.fingerprint.category}`
        : `Fixed after ${attempt} attempt(s)`;

      useAgentMemoryStore.getState().recordCommandOutcome(
        useWorkbenchStore.getState().projectName,
        winningCmd,
        true,
        undefined,
        resolution,
      );

      // Also record winning install command to installs.json so future buildInstallContext sees it
      if (winningAttempt && isInstallCommand(winningCmd)) {
        try {
          const { projectPath, files } = useWorkbenchStore.getState();
          const { resolveEffectiveRoot } = await import('@/services/memoryManager');
          const root = projectPath ? resolveEffectiveRoot(projectPath, files) : '';
          if (root) {
            const record = buildInstallRecord(winningCmd, 0, '', winningAttempt.errorSnippet, attempt, step.id, resolution);
            recordInstall(record, root).catch(() => {});
          }
        } catch { /* non-fatal */ }
      }

      // Persist the full ledger summary -- next time the same error category appears,
      // buildMemoryPrompt will surface the complete repair history from this session
      useAgentMemoryStore.getState().addMemory({
        projectName: useWorkbenchStore.getState().projectName,
        category: 'error_fix',
        title: `Repair succeeded: ${winningAttempt?.fingerprint.category ?? 'unknown'} -- ${step.description.slice(0, 60)}`,
        content: [
          `Step: ${step.description}`,
          `Winning strategy: ${winningAttempt?.strategyId ?? 'unknown'} (${winningAttempt?.strategyFamily ?? 'unknown'})`,
          `Winning command: ${winningCmd.slice(0, 300)}`,
          `Error category: ${winningAttempt?.fingerprint.category ?? 'unknown'}`,
          `Error signature: ${winningAttempt?.fingerprint.errorSignature ?? 'unknown'}`,
          '',
          formatLedgerForPrompt(ledger),
        ].join('\n'),
        tags: [
          winningAttempt?.fingerprint.category ?? 'unknown',
          winningAttempt?.strategyFamily ?? 'unknown',
          repairContext.packageManager ?? 'unknown',
        ].filter(Boolean),
      });
    }

    callbacks.onStepDone(step);
  }

  if (stoppedEarly) {
    callbacks.onTerminal(
      userCancelled ? '--- Plan cancelled ---' : '--- Plan stopped (validation/repair failed) ---',
    );
    callbacks.onLog(
      userCancelled ? 'Cancelled by user.' : 'Plan stopped early -- fix the reported issue before continuing.',
      userCancelled ? 'info' : 'warning',
    );
    if (!userCancelled) {
      callbacks.onPlanStoppedEarly?.(stopReason);
    }
  } else {
    callbacks.onAllDone();
    callbacks.onTerminal('--- Plan execution complete ---');
    callbacks.onLog('All steps completed', 'success');
  }
}
