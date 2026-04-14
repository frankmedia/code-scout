/**
 * AppMessageBanner — top-of-app banner for announcements, "buy me a coffee", etc.
 *
 * The banner content is fetched from BANNER_URL (a remote JSON file you control).
 * Update that file at any time to push a new message to all users without a release.
 * Falls back to FALLBACK_BANNER if the remote fetch fails or while loading.
 *
 * Remote JSON shape:
 *   { "message": "...", "link": "https://...", "linkText": "...", "color": "amber|blue|green|red|purple" }
 *   Set "message" to "" or return 404 to hide the banner.
 */
import { useState, useEffect } from 'react';
import { X, Coffee, ExternalLink } from 'lucide-react';

// ─── Config ──────────────────────────────────────────────────────────────────
//
// Host a file like this on GitHub raw / Gist / any CDN:
//   { "message": "☕ Enjoying Code Scout? Support the project!", "link": "https://buymeacoffee.com/yourpage", "linkText": "Buy me a coffee", "color": "amber" }
//
// Set VITE_ANNOUNCEMENT_BANNER_URL to a raw JSON URL. Default: no fetch (avoids stale third-party text in the shell).
const BANNER_URL = (import.meta.env.VITE_ANNOUNCEMENT_BANNER_URL as string | undefined)?.trim() ?? '';

// No fallback text — avoids stale or third-party copy in the bundle. Remote JSON only.
const FALLBACK_BANNER: BannerData | null = null;

// Session-storage key so the banner stays dismissed within a single session.
const DISMISSED_KEY = 'code-scout-banner-dismissed';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BannerData {
  message: string;
  link?: string;
  linkText?: string;
  /** amber | blue | green | red | purple */
  color?: string;
}

// ─── Color map ────────────────────────────────────────────────────────────────

const COLOR_CLASSES: Record<string, { bg: string; text: string; border: string; link: string }> = {
  amber:  { bg: 'bg-amber-500/10',  text: 'text-amber-700 dark:text-amber-300',  border: 'border-amber-500/20',  link: 'text-amber-800 dark:text-amber-200 hover:opacity-80' },
  blue:   { bg: 'bg-blue-500/10',   text: 'text-blue-700 dark:text-blue-300',    border: 'border-blue-500/20',   link: 'text-blue-800 dark:text-blue-200 hover:opacity-80' },
  green:  { bg: 'bg-green-500/10',  text: 'text-green-700 dark:text-green-300',  border: 'border-green-500/20',  link: 'text-green-800 dark:text-green-200 hover:opacity-80' },
  red:    { bg: 'bg-red-500/10',    text: 'text-red-700 dark:text-red-300',      border: 'border-red-500/20',    link: 'text-red-800 dark:text-red-200 hover:opacity-80' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-500/20', link: 'text-purple-800 dark:text-purple-200 hover:opacity-80' },
};

function getColors(color?: string) {
  return COLOR_CLASSES[color ?? 'amber'] ?? COLOR_CLASSES.amber;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Hide banner if remote copy looks like old waitlist / register CTAs (not shipped in-app anymore). */
function isBlockedBannerMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('waitlist') ||
    m.includes("don't have an account") ||
    m.includes('don’t have an account') ||
    m.includes('? register') ||
    m.includes('product overview') ||
    m.includes('public page') ||
    m.includes('no account')
  );
}

export function AppMessageBanner() {
  const [banner, setBanner] = useState<BannerData | null>(FALLBACK_BANNER);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISSED_KEY) === '1',
  );

  useEffect(() => {
    let cancelled = false;
    if (!BANNER_URL) {
      setBanner(null);
      return;
    }
    fetch(BANNER_URL, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then((data: BannerData | null) => {
        if (cancelled) return;
        if (data && typeof data.message === 'string') {
          const trimmed = data.message.trim();
          if (!trimmed || isBlockedBannerMessage(trimmed)) {
            setBanner(null);
            return;
          }
          setBanner(data);
        }
      })
      .catch(() => { /* no banner */ });
    return () => { cancelled = true; };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, '1');
  };

  if (dismissed || !banner?.message) return null;

  const colors = getColors(banner.color);

  return (
    <div
      className={`
        flex items-center justify-between gap-3 px-4 py-1.5
        border-b ${colors.bg} ${colors.border} shrink-0
      `}
    >
      <div className={`flex items-center gap-2 text-xs ${colors.text} min-w-0`}>
        <Coffee className="h-3 w-3 shrink-0" />
        <span className="truncate">{banner.message}</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {banner.link && (
          <a
            href={banner.link}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline transition-colors ${colors.link}`}
          >
            {banner.linkText ?? 'Learn more'}
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
        <button
          onClick={handleDismiss}
          className={`p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity ${colors.text}`}
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
