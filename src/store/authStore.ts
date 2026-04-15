/**
 * authStore — persisted login state for Code Scout.
 *
 * Authenticates against the hosted API at llmscout.co/api/codescout.
 * Falls back to a hardcoded allow-list when the API is unreachable
 * (e.g. no network).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const AUTH_API = 'https://llmscout.co/api/codescout';

// ---------------------------------------------------------------------------
// Offline fallback — used when the hosted API is unreachable.
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
// API helpers
// ---------------------------------------------------------------------------

interface ApiUser {
  id: number;
  username: string;
  accountType: string;
}

interface ApiResponse {
  ok?: boolean;
  error?: string;
  user?: ApiUser;
}

async function authFetch(endpoint: string, username: string, password: string): Promise<ApiResponse> {
  const res = await fetch(`${AUTH_API}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json: ApiResponse = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
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
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
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

        try {
          const data = await authFetch('login', username, pw);
          if (data.user) {
            set({ user: { email: data.user.username, accountType: data.user.accountType } });
            return { ok: true };
          }
          return { ok: false, error: 'Unexpected response from server' };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // Network failure — try offline fallback
          if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
            if (checkOffline(username, pw)) {
              set({ user: { email: username } });
              return { ok: true };
            }
          }
          return { ok: false, error: msg };
        }
      },

      register: async (email, password) => {
        const username = email.toLowerCase().trim();
        const pw = password.trim();

        try {
          const data = await authFetch('register', username, pw);
          if (data.user) {
            set({ user: { email: data.user.username, accountType: data.user.accountType } });
            return { ok: true };
          }
          return { ok: false, error: 'Unexpected response from server' };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, error: msg };
        }
      },

      logout: () => set({ user: null }),
    }),
    {
      name: 'code-scout-auth',
      version: 3,
      partialize: (state) => ({ user: state.user }),
      migrate: (persisted: unknown, version: number) => {
        if (version < 3) {
          const old = persisted as { user?: { email: string } | null };
          return { user: old?.user ?? null } as Partial<AuthState>;
        }
        return persisted as Partial<AuthState>;
      },
    },
  ),
);
