/**
 * authStore — persisted login state for Code Scout.
 *
 * When running inside Tauri, credentials are verified against the MySQL
 * backend via `db_login` / `db_register` Tauri commands.
 * Falls back to a hardcoded allow-list when the backend is unavailable
 * (e.g. running in the browser or before the DB pool is ready).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Inline isTauri check to avoid circular dependency through @/lib/tauri → workbenchStore
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { isTauri?: boolean };
  return Boolean(w.isTauri || '__TAURI_INTERNALS__' in window);
}

// ---------------------------------------------------------------------------
// Offline fallback — used when the MySQL backend is unreachable.
// ---------------------------------------------------------------------------
const OFFLINE_USERS: Array<{ email: string; password: string }> = [
  { email: 'frank@orchidbox.com', password: 'limited1' },
];

function checkOffline(email: string, password: string): boolean {
  const e = email.toLowerCase().trim();
  const p = password.trim();
  return OFFLINE_USERS.some(u => u.email.toLowerCase() === e && u.password === p);
}

// ---------------------------------------------------------------------------
// Tauri invoke helpers
// ---------------------------------------------------------------------------

interface DbUser {
  id: number;
  username: string;
  accountType: string;
}

async function tauriInvoke<T>(cmd: string, args: Record<string, string>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface AuthUser {
  email: string;
  accountType?: string;
}

interface AuthState {
  user: AuthUser | null;
  /** Login with email + password. Async because it may call the backend. */
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Register a new account via the backend. */
  register: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,

      login: async (email, password) => {
        const username = email.toLowerCase().trim();
        const pw = password.trim();

        // Try Tauri backend first
        if (isTauri()) {
          try {
            const u = await tauriInvoke<DbUser>('db_login', { username, password: pw });
            set({ user: { email: u.username, accountType: u.accountType } });
            return { ok: true };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            // If the DB is simply unreachable, fall through to offline check
            if (!msg.includes('Invalid username') && !msg.includes('not found')) {
              // Genuine backend error — try offline fallback
              if (checkOffline(username, pw)) {
                set({ user: { email: username } });
                return { ok: true };
              }
              return { ok: false, error: msg };
            }
            return { ok: false, error: 'Invalid username or password' };
          }
        }

        // Browser / non-Tauri: offline only
        if (checkOffline(username, pw)) {
          set({ user: { email: username } });
          return { ok: true };
        }
        return { ok: false, error: 'Invalid email or password' };
      },

      register: async (email, password) => {
        const username = email.toLowerCase().trim();
        const pw = password.trim();

        if (!isTauri()) {
          return { ok: false, error: 'Registration requires the desktop app' };
        }

        try {
          const u = await tauriInvoke<DbUser>('db_register', { username, password: pw });
          set({ user: { email: u.username, accountType: u.accountType } });
          return { ok: true };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, error: msg };
        }
      },

      logout: () => set({ user: null }),
    }),
    {
      name: 'code-scout-auth',
      version: 2,
      partialize: (state) => ({ user: state.user }),
      migrate: (persisted: unknown, version: number) => {
        // v1 → v2: login became async, added register. Only `user` is persisted so
        // the migration just passes through.
        if (version < 2) {
          const old = persisted as { user?: { email: string } | null };
          return { user: old?.user ?? null } as Partial<AuthState>;
        }
        return persisted as Partial<AuthState>;
      },
    },
  ),
);
