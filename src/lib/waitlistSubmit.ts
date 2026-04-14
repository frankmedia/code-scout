import { WAITLIST_CONSENT_VERSION } from "@/constants/waitlistConsent";

export type WaitlistSubmitInput = {
  email: string;
  consent: boolean;
  /** Honeypot — must stay empty for real signups */
  website: string;
  source?: string;
  landingPath: string;
};

export type WaitlistSubmitResult =
  | { ok: true }
  | { ok: false; error: "network" | "invalid" | "server" | "config" };

function trimApiBase(base: string): string {
  return base.replace(/\/+$/, "");
}

export async function submitWaitlistSignup(
  input: WaitlistSubmitInput,
  signal?: AbortSignal,
): Promise<WaitlistSubmitResult> {
  const base = import.meta.env.VITE_WAITLIST_API_URL?.trim();
  if (!base) {
    return { ok: false, error: "config" };
  }

  const url = `${trimApiBase(base)}/api/waitlist`;

  if (!input.consent) {
    return { ok: false, error: "invalid" };
  }

  const body: Record<string, unknown> = {
    email: input.email.trim(),
    consent: true,
    consentVersion: WAITLIST_CONSENT_VERSION,
    website: input.website,
    landingPath: input.landingPath,
  };
  if (input.source) {
    body.source = input.source;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return { ok: false, error: "network" };
  }

  if (res.status === 429) {
    return { ok: false, error: "server" };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "server" };
  }

  const ok =
    typeof json === "object" &&
    json !== null &&
    (json as { ok?: unknown }).ok === true;

  if (res.ok && ok) {
    return { ok: true };
  }

  if (res.status >= 400 && res.status < 500) {
    return { ok: false, error: "invalid" };
  }

  return { ok: false, error: "server" };
}
