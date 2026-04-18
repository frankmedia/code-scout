import { PlanStep, useWorkbenchStore } from '@/store/workbenchStore';
import { ModelConfig } from '@/store/modelStore';
import { callModel, modelToRequest, ModelRequestMessage } from './modelApi';

export interface VerificationInput {
  step: PlanStep;
  fileExistsBefore: boolean;
  fileExistsAfter: boolean;
  contentBefore: string | undefined;
  contentAfter: string | undefined;
  errorOutput?: string;
}

export interface VerificationResult {
  stepId: string;
  result: 'pass' | 'fail' | 'partial';
  summary: string;
  observedFacts: string[];
  likelyCauses: string[];
  recommendedAction: 'continue' | 'retry' | 'stop' | 'escalate';
}

// ─── Deterministic checks (no LLM needed) ─────────────────────────────────

function runDeterministicChecks(input: VerificationInput): VerificationResult | null {
  const { step, fileExistsBefore, fileExistsAfter, contentBefore, contentAfter, errorOutput } = input;
  const facts: string[] = [];

  if (step.action === 'create_file') {
    if (fileExistsAfter && contentAfter) {
      facts.push(`File ${step.path} created successfully`);
      facts.push(`Content length: ${contentAfter.length} chars`);
      return {
        stepId: step.id,
        result: 'pass',
        summary: `File created at ${step.path}`,
        observedFacts: facts,
        likelyCauses: [],
        recommendedAction: 'continue',
      };
    } else if (!fileExistsAfter) {
      return {
        stepId: step.id,
        result: 'fail',
        summary: `File ${step.path} was not created`,
        observedFacts: [`File ${step.path} not found in file tree`],
        likelyCauses: ['File creation failed', 'Path may be invalid'],
        recommendedAction: 'retry',
      };
    }
  }

  if (step.action === 'edit_file') {
    if (!fileExistsAfter) {
      return {
        stepId: step.id,
        result: 'fail',
        summary: `Target file ${step.path} not found`,
        observedFacts: [`File ${step.path} missing`],
        likelyCauses: ['File was deleted', 'Wrong path'],
        recommendedAction: 'stop',
      };
    }
    if (contentBefore === contentAfter && contentBefore !== undefined) {
      return {
        stepId: step.id,
        result: 'partial',
        summary: `File ${step.path} content unchanged`,
        observedFacts: ['File exists but content did not change'],
        likelyCauses: ['Edit may not have applied', 'Diff did not match'],
        recommendedAction: 'retry',
      };
    }
    if (fileExistsAfter && contentAfter && contentBefore !== contentAfter) {
      return {
        stepId: step.id,
        result: 'pass',
        summary: `File ${step.path} updated`,
        observedFacts: [`Content changed (${(contentBefore?.length || 0)} → ${contentAfter.length} chars)`],
        likelyCauses: [],
        recommendedAction: 'continue',
      };
    }
  }

  if (step.action === 'delete_file') {
    if (!fileExistsAfter && fileExistsBefore) {
      return {
        stepId: step.id,
        result: 'pass',
        summary: `File ${step.path} deleted`,
        observedFacts: ['File no longer in file tree'],
        likelyCauses: [],
        recommendedAction: 'continue',
      };
    }
    if (fileExistsAfter) {
      return {
        stepId: step.id,
        result: 'fail',
        summary: `File ${step.path} still exists after delete`,
        observedFacts: ['File found in tree after deletion step'],
        likelyCauses: ['Delete operation failed'],
        recommendedAction: 'retry',
      };
    }
  }

  if (step.action === 'run_command') {
    if (errorOutput) {
      return {
        stepId: step.id,
        result: 'fail',
        summary: `Command failed: ${step.command}`,
        observedFacts: [`Error: ${errorOutput.slice(0, 200)}`],
        likelyCauses: ['Command not found', 'Dependency missing', 'Permission error'],
        recommendedAction: 'stop',
      };
    }
    return {
      stepId: step.id,
      result: 'pass',
      summary: `Command executed: ${step.command}`,
      observedFacts: ['Command ran successfully'],
      likelyCauses: [],
      recommendedAction: 'continue',
    };
  }

  return null;
}

// ─── LLM-assisted verification (for error interpretation only) ────────────

async function interpretWithLLM(
  input: VerificationInput,
  model: ModelConfig,
): Promise<VerificationResult> {
  const prompt = `You are a code verifier. A coding step was executed. Determine if it succeeded.

Step: ${input.step.action} on ${input.step.path || input.step.command}
Description: ${input.step.description}
${input.errorOutput ? `Error output: ${input.errorOutput.slice(0, 500)}` : 'No error output'}
${input.contentAfter ? `File content after (first 200 chars): ${input.contentAfter.slice(0, 200)}` : ''}

Respond with ONLY valid JSON:
{
  "result": "pass|fail|partial",
  "summary": "one sentence",
  "observedFacts": ["..."],
  "likelyCauses": ["..."],
  "recommendedAction": "continue|retry|stop|escalate"
}`;

  return new Promise((resolve) => {
    const messages: ModelRequestMessage[] = [{ role: 'user', content: prompt }];
    let fullText = '';
    let gotTokens = false;

    callModel(
      modelToRequest(model, messages),
      (chunk) => { fullText += chunk; },
      (text) => {
        if (!gotTokens) {
          const est = Math.ceil(prompt.length / 4) + Math.ceil((text || fullText).length / 4);
          if (est > 0) useWorkbenchStore.getState().addAiSessionTokens(est);
        }
        try {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            resolve({
              stepId: input.step.id,
              result: parsed.result || 'partial',
              summary: parsed.summary || 'Verification complete',
              observedFacts: parsed.observedFacts || [],
              likelyCauses: parsed.likelyCauses || [],
              recommendedAction: parsed.recommendedAction || 'continue',
            });
            return;
          }
        } catch {
          // fallthrough
        }
        resolve({
          stepId: input.step.id,
          result: 'partial',
          summary: 'Could not parse verifier response',
          observedFacts: [],
          likelyCauses: [],
          recommendedAction: 'continue',
        });
      },
      () => resolve({
        stepId: input.step.id,
        result: 'partial',
        summary: 'Verifier model unavailable',
        observedFacts: [],
        likelyCauses: [],
        recommendedAction: 'continue',
      }),
      (usage) => {
        gotTokens = true;
        const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        if (total > 0) useWorkbenchStore.getState().addAiSessionTokens(total);
      },
    );
  });
}

// ─── Main verify function ─────────────────────────────────────────────────

export async function verifyStep(
  input: VerificationInput,
  verifierModel?: ModelConfig,
): Promise<VerificationResult> {
  // Run deterministic checks first (no LLM)
  const deterministic = runDeterministicChecks(input);
  if (deterministic) return deterministic;

  // Fall back to LLM only when deterministic checks are inconclusive and there's an error
  if (verifierModel && input.errorOutput) {
    return interpretWithLLM(input, verifierModel);
  }

  // Default pass when no error and deterministic check was inconclusive
  return {
    stepId: input.step.id,
    result: 'pass',
    summary: 'Step completed',
    observedFacts: ['No errors detected'],
    likelyCauses: [],
    recommendedAction: 'continue',
  };
}
