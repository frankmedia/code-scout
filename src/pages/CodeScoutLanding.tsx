import { Link } from "react-router-dom";
import { Bot, Github, Download } from "lucide-react";
import { CodeScoutScreenshotGallery } from "@/components/marketing/CodeScoutScreenshotGallery";

/** Decorative monochrome apple mark (not an official Apple trademark asset). */
function AppleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.35-2.51 1.34-.03 2.64.45 3.31 1.26 1.26 0 0 2.37-.45 3.78-.47 1.61-.03 2.86.72 3.73 1.87-3.2 1.77-2.5 5.61.64 6.88zm1.9-17.18c.67-.81 1.53-2.22 1.36-3.54-1.4.09-2.7.93-3.54 2.01-.73.94-1.4 2.26-1.22 3.6 1.45.11 2.86-.73 3.4-2.07z" />
    </svg>
  );
}

const HERO_POINTS = [
  "Your tree, git, and terminal live next to the model—no pasting snippets into a browser tab.",
  "Orchestrator and coder flows: plan and constrain work, then implement with full repo context.",
  "Local inference first (e.g. Ollama); cloud APIs only if you add a key—then their policies apply.",
  "Heartbeat mirrors the loop: as work moves between planner, tools, and the local model, the UI keeps a living signal—especially when stdout is long, latency varies, or you need to know it’s safe to send another message.",
] as const;

export default function CodeScoutLanding() {
  const privacyUrl = import.meta.env.VITE_PRIVACY_POLICY_URL?.trim();
  const termsUrl = import.meta.env.VITE_TERMS_URL?.trim();
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();
  const githubUrl = import.meta.env.VITE_CODE_SCOUT_GITHUB_URL?.trim();

  const supportHref = supportEmail ? `mailto:${supportEmail}` : undefined;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="border-b border-border/80 bg-card/30 backdrop-blur-sm sticky top-0 z-40">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Bot className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold tracking-tight">Code Scout</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                <AppleMark className="h-3 w-3 text-foreground/80" />
                macOS only
              </span>
            </div>
          </div>
          <Link
            to="/code-scout/download"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 py-12 md:py-16 space-y-16 md:space-y-20">
        <section className="grid gap-10 lg:grid-cols-2 lg:gap-12 lg:items-center" aria-labelledby="hero-heading">
          <div className="space-y-6">
            <p
              className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium uppercase tracking-wider text-muted-foreground"
              title="Native Mac app"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-foreground/90">
                <AppleMark className="h-3.5 w-3.5" />
                macOS only
              </span>
              <span className="text-muted-foreground">·</span>
              <span>Desktop workbench</span>
            </p>
            <div className="space-y-4">
              <h1
                id="hero-heading"
                className="text-3xl font-bold tracking-tight leading-[1.15] sm:text-4xl md:text-[2.35rem] md:leading-tight"
              >
                AI coding that stays in your repo—not a detached chat window.
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed md:text-lg">
                <strong className="font-medium text-foreground">Code Scout</strong> is a desktop workbench for real
                codebases: models work beside your file tree, git, and terminal so assistance matches how you actually
                ship. Built for engineers who want control—local models by default, optional APIs when you wire them in.{" "}
                <strong className="font-medium text-foreground">
                  Mac-only for now; Windows and Linux are on the roadmap.
                </strong>
              </p>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/35 pl-4">
              {HERO_POINTS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                to="/code-scout/download"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors w-full sm:w-auto"
              >
                <Download className="h-4 w-4" aria-hidden />
                Download for Mac
              </Link>
              <p className="text-xs text-muted-foreground sm:max-w-xs">
                <span className="inline-flex items-center gap-1 text-foreground/90">
                  <AppleMark className="h-3 w-3 shrink-0" />
                  Apple Silicon builds (.dmg). Use the in-app updater after install.
                </span>
              </p>
            </div>
          </div>
          <CodeScoutScreenshotGallery variant="hero" />
        </section>

        <section
          id="privacy-policy"
          className="mx-auto max-w-xl rounded-lg border border-border/80 bg-muted/15 px-4 py-3 text-center sm:text-left"
        >
          <p className="text-xs text-muted-foreground leading-relaxed">
            {privacyUrl ? (
              <a href={privacyUrl} className="text-primary hover:underline font-medium" rel="noopener noreferrer" target="_blank">
                Privacy policy
              </a>
            ) : (
              <span className="text-muted-foreground/90">Privacy policy link via VITE_PRIVACY_POLICY_URL when published.</span>
            )}
            {termsUrl ? (
              <>
                {" · "}
                <a href={termsUrl} className="text-primary hover:underline font-medium" rel="noopener noreferrer" target="_blank">
                  Terms
                </a>
              </>
            ) : null}
          </p>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-[11px] text-muted-foreground space-y-2">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          {privacyUrl ? (
            <a href={privacyUrl} className="hover:text-foreground transition-colors" rel="noopener noreferrer" target="_blank">
              Privacy
            </a>
          ) : (
            <a href="#privacy-policy" className="hover:text-foreground transition-colors">
              Privacy
            </a>
          )}
          <span className="text-border">·</span>
          {termsUrl ? (
            <a href={termsUrl} className="hover:text-foreground transition-colors" rel="noopener noreferrer" target="_blank">
              Terms
            </a>
          ) : (
            <span className="text-muted-foreground/80">Terms (set VITE_TERMS_URL)</span>
          )}
          <span className="text-border">·</span>
          <Link to="/code-scout/download" className="hover:text-foreground transition-colors inline-flex items-center gap-1">
            <Download className="h-3 w-3" aria-hidden />
            Download
          </Link>
          {githubUrl ? (
            <>
              <span className="text-border">·</span>
              <a
                href={githubUrl}
                className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                rel="noopener noreferrer"
                target="_blank"
              >
                <Github className="h-3 w-3" aria-hidden />
                GitHub
              </a>
            </>
          ) : null}
          {supportHref ? (
            <>
              <span className="text-border">·</span>
              <a href={supportHref} className="hover:text-foreground transition-colors">
                Contact
              </a>
            </>
          ) : null}
        </div>
        <p className="text-muted-foreground/70 inline-flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5">
          <AppleMark className="h-3 w-3 shrink-0 opacity-80" />
          <span>Code Scout — macOS desktop app · AI workbench for real repositories</span>
        </p>
      </footer>
    </div>
  );
}
