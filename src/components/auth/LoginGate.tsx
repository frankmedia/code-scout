/**
 * LoginGate — two-step pre-auth explainer, then register or sign in.
 */
import { useState, useEffect, type FormEvent, type ReactNode } from 'react';
import { Bot, Eye, EyeOff, Lock, Mail, AlertCircle, LogIn, UserPlus } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { PreAuthStepOne, PreAuthStepTwo } from '@/components/auth/PreAuthScreens';
import { PRE_AUTH_FLOW_VERSION } from '@/config/preAuthFlow';

/** Legacy key from older builds. */
const LEGACY_INTRO_KEY = 'codescout_approach_intro_v1';
/** When set, user has completed both pre-auth screens (for the current flow version). */
const PRE_AUTH_DONE_KEY = 'codescout_pre_auth_done_v4';
const PRE_AUTH_VERSION_KEY = 'codescout_pre_auth_flow_version';

function readPreAuthDone(): boolean {
  try {
    return localStorage.getItem(PRE_AUTH_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

/** If we shipped new intro copy, clear "done" so the guide runs again after sign-out. */
function reconcilePreAuthFlowVersion(): void {
  try {
    const prev = localStorage.getItem(PRE_AUTH_VERSION_KEY);
    if (prev !== PRE_AUTH_FLOW_VERSION) {
      localStorage.removeItem(PRE_AUTH_DONE_KEY);
      localStorage.removeItem(LEGACY_INTRO_KEY);
      localStorage.setItem(PRE_AUTH_VERSION_KEY, PRE_AUTH_FLOW_VERSION);
    }
  } catch {
    /* ignore */
  }
}

function phaseAfterReconcile(): 'step1' | 'step2' | 'auth' {
  reconcilePreAuthFlowVersion();
  return readPreAuthDone() ? 'auth' : 'step1';
}

export function LoginGate({ children }: { children: ReactNode }) {
  const user = useAuthStore(s => s.user);
  const [authReady, setAuthReady] = useState(() => useAuthStore.persist.hasHydrated());
  const [phase, setPhase] = useState<'step1' | 'step2' | 'auth'>(() =>
    useAuthStore.persist.hasHydrated() ? phaseAfterReconcile() : 'step1',
  );

  useEffect(() => {
    if (authReady) return;
    if (useAuthStore.persist.hasHydrated()) {
      setPhase(phaseAfterReconcile());
      setAuthReady(true);
      return;
    }
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setPhase(phaseAfterReconcile());
      setAuthReady(true);
    });
    return unsub;
  }, [authReady]);

  if (!authReady) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#f7f3ea]">
        <div
          className="h-6 w-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
          aria-label="Loading session"
        />
      </div>
    );
  }

  if (user) return <>{children}</>;

  if (phase === 'step1') {
    return <PreAuthStepOne onNext={() => setPhase('step2')} />;
  }

  if (phase === 'step2') {
    return (
      <PreAuthStepTwo
        onContinue={() => {
          try {
            localStorage.setItem(PRE_AUTH_DONE_KEY, '1');
          } catch {
            /* ignore */
          }
          setPhase('auth');
        }}
      />
    );
  }

  return <AuthScreen onBack={() => setPhase('step1')} />;
}

function AuthScreen({ onBack }: { onBack: () => void }) {
  const login = useAuthStore(s => s.login);
  const register = useAuthStore(s => s.register);
  const [mode, setMode] = useState<'register' | 'signin'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);

    const result =
      mode === 'register'
        ? await register(email.trim(), password.trim())
        : await login(email.trim(), password.trim());

    setLoading(false);
    if (!result.ok) {
      setError(result.error || 'Authentication failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#f7f3ea]">
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(15, 23, 42, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center gap-8 px-6 text-slate-900 [&_.text-foreground]:text-slate-900 [&_.text-muted-foreground]:text-slate-600">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            title="Review intro"
            className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg cursor-pointer transition-all hover:scale-105 hover:bg-primary/15 active:scale-95"
          >
            <Bot className="h-7 w-7 text-primary" />
          </button>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Code Scout</h1>
            <p className="text-sm text-muted-foreground mt-0.5">AI-powered IDE for local LLMs</p>
            <p className="text-[11px] text-muted-foreground/90 mt-2 max-w-[280px] leading-relaxed">
              Connect your models: an <strong className="text-foreground/90">orchestrator</strong> to coordinate and a{' '}
              <strong className="text-foreground/90">coder</strong> to edit files.
            </p>
            <span className="mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25 tracking-wide uppercase">
              Beta
            </span>
          </div>
        </div>

        <div className="w-full rounded-2xl border border-slate-200/90 bg-white/92 p-6 shadow-xl backdrop-blur-sm space-y-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100/90 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                mode === 'signin'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign in
            </button>
          </div>

          <div className="flex items-center gap-2 text-foreground">
            {mode === 'register' ? (
              <UserPlus className="h-4 w-4 text-muted-foreground" />
            ) : (
              <LogIn className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-semibold">{mode === 'register' ? 'Register' : 'Sign in'}</span>
          </div>

          <div>
            <h2 className="text-base font-semibold text-foreground">
              {mode === 'register' ? 'Create your account' : 'Sign in to continue'}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode === 'register'
                ? 'Register first if this is your first time using Code Scout.'
                : 'Use your existing Code Scout account.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email or username</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="username"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-900"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Confirm password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="new-password"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !password || (mode === 'register' && !confirmPassword)}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                  {mode === 'register' ? 'Creating account…' : 'Signing in…'}
                </span>
              ) : (
                mode === 'register' ? 'Register' : 'Sign in'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
