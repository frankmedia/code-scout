/**
 * Two full-screen steps before sign-in (progress is obvious: screen 1 → screen 2 → login).
 * Light warm theme — intentionally different from the dark in-app workspace.
 */
import type { ReactNode } from 'react';
import { ArrowRight, Bot, Cpu, FlaskConical, Layers, Scale, WifiOff } from 'lucide-react';


function PreAuthChrome({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-y-auto bg-[#f7f3ea] py-10">
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(15, 23, 42, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      {children}
    </div>
  );
}

function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden>
      <span className={`h-2 w-2 rounded-full ${step === 1 ? 'bg-primary' : 'bg-slate-300'}`} />
      <span className={`h-2 w-2 rounded-full ${step === 2 ? 'bg-primary' : 'bg-slate-300'}`} />
    </div>
  );
}

export function PreAuthStepOne({ onNext }: { onNext: () => void }) {
  return (
    <PreAuthChrome>
      <div className="relative z-10 flex w-full max-w-xl flex-col items-center gap-6 px-6">
        <StepDots step={1} />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Step 1 of 2</p>

        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-lg">
            <Bot className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Why Code Scout is different</h1>
          <p className="max-w-md text-sm leading-relaxed text-slate-600">
            Code Scout is a <strong className="font-semibold text-slate-900">lightweight coding workbench</strong> built
            around local and small language models—not a full desktop IDE stack, so the agent gets a focused tool surface.
          </p>
        </div>

        <div className="w-full space-y-4">
          <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10">
              <Layers className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Orchestrator and coder</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                An <strong className="font-semibold text-slate-800">orchestrator</strong> coordinates and verifies; a{' '}
                <strong className="font-semibold text-slate-800">coder</strong> edits files. Smaller contexts, steadier tool use on
                modest models.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
              <WifiOff className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Offline and free on capable hardware</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                With hardware that runs local models well (e.g. <strong className="font-semibold text-slate-800">Ollama</strong>), you can
                run the <strong className="font-semibold text-slate-800">whole loop</strong> without sending code to the cloud. Cloud
                APIs stay optional.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
              <Cpu className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Designed for small models</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Everything from prompts to file structure is engineered for tight context windows and weaker tool use,
                not bloated cloud models.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onNext}
          className="flex w-full max-w-sm items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
        >
          Next
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </PreAuthChrome>
  );
}

export function PreAuthStepTwo({ onContinue }: { onContinue: () => void }) {
  return (
    <PreAuthChrome>
      <div className="relative z-10 flex w-full max-w-xl flex-col items-center gap-6 px-6">
        <StepDots step={2} />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Step 2 of 2</p>

        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-500/20 bg-violet-500/10 shadow-lg">
            <FlaskConical className="h-7 w-7 text-violet-600" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Models, trust, and benchmarks</h1>
        </div>

        <div className="w-full space-y-4">
          <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10">
              <Scale className="h-4 w-4 text-sky-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Vendor-neutral by design</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                We don&apos;t bias toward any model provider. Our benchmarks show strong results with{' '}
                <strong className="font-semibold text-slate-800">Kimi K2.5</strong> and{' '}
                <strong className="font-semibold text-slate-800">Qwen3 Coder</strong> for orchestration and execution, but
                configurations will vary by use case.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10">
              <FlaskConical className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Standardised benchmarks across all models</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                The <strong className="font-semibold text-slate-800">Benchmark</strong> tab runs a fixed evaluation suite with a
                unified leaderboard.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Metrics cover <strong className="font-semibold text-slate-800">code generation</strong>,{' '}
                <strong className="font-semibold text-slate-800">patching</strong>,{' '}
                <strong className="font-semibold text-slate-800">debugging</strong>,{' '}
                <strong className="font-semibold text-slate-800">reasoning</strong>,{' '}
                <strong className="font-semibold text-slate-800">long-context performance</strong>, tool interaction (
                <strong className="font-semibold text-slate-800">file</strong>,{' '}
                <strong className="font-semibold text-slate-800">shell</strong>,{' '}
                <strong className="font-semibold text-slate-800">web</strong>),{' '}
                <strong className="font-semibold text-slate-800">Pass@1</strong> on executable checks,{' '}
                <strong className="font-semibold text-slate-800">latency</strong>, and{' '}
                <strong className="font-semibold text-slate-800">throughput (tokens/sec)</strong>.
              </p>
            </div>
          </div>
        </div>

        <p className="max-w-md border-t border-slate-200 pt-4 text-center text-xs leading-relaxed text-slate-600">
          We hope this IDE gives developers around the world{' '}
          <strong className="font-semibold text-slate-800">more freedom</strong> to use{' '}
          <strong className="font-semibold text-slate-800">local AI</strong> and pursue their own dreams—on their own terms.
        </p>

        <div className="flex w-full max-w-sm flex-col items-center gap-2">
          <button
            type="button"
            onClick={onContinue}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
          >
            Continue to sign in
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </PreAuthChrome>
  );
}
