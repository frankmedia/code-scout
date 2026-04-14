export type WaitlistAnalyticsEvent = "page_view" | "submit_success";

/**
 * Optional analytics hook: listen with
 * `window.addEventListener('codescout-waitlist', (e) => …)` or wire GTM later.
 */
export function emitWaitlistAnalytics(event: WaitlistAnalyticsEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("codescout-waitlist", { detail: { event } }));
}
