import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Apple, ArrowLeft, Download, FileJson, Loader2 } from "lucide-react";

type VersionManifest = {
  version: string;
  url: string;
  notes?: string;
};

export default function CodeScoutDownload() {
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/code-scout/download/version.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as VersionManifest;
        if (!cancelled) setManifest(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load version.json");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const version = manifest?.version ?? null;
  const dmgName = version ? `Code Scout_${version}_aarch64.dmg` : null;
  const dmgHref = dmgName ? `/code-scout/download/${encodeURIComponent(dmgName)}` : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200">
      <div className="mx-auto max-w-lg px-6 py-16">
        <Link
          to="/code-scout"
          className="mb-10 inline-flex items-center gap-2 text-sm text-neutral-500 transition-colors hover:text-neutral-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Code Scout
        </Link>

        <div className="mb-2 flex items-center gap-3">
          <Apple className="h-10 w-10 text-neutral-400" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight text-white">Download Code Scout</h1>
        </div>
        <p className="mb-10 text-sm leading-relaxed text-neutral-500">
          macOS builds for Apple Silicon. Install by opening the disk image and dragging the app into{" "}
          <code className="rounded bg-neutral-900 px-1.5 py-0.5 text-neutral-300">Applications</code>.
        </p>

        <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-950/80 p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">Installer (DMG)</h2>
          {!manifest && !error && (
            <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Resolving version…
            </div>
          )}
          {dmgHref ? (
            <a
              href={dmgHref}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-opacity hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Download DMG (aarch64) — v{version}
            </a>
          ) : null}
          {(error || manifest) && !dmgHref && (
            <p className="text-sm text-neutral-500">Load the manifest above to enable the DMG link.</p>
          )}
          <p className="text-xs text-neutral-600">
            If the DMG link 404s, run <code className="text-neutral-400">npm run tauri:build</code> and copy the file from{" "}
            <code className="text-neutral-400">src-tauri/target/release/bundle/dmg/</code> into{" "}
            <code className="text-neutral-400">public/code-scout/download/</code> using the same name as above, then
            redeploy.
          </p>
        </div>

        <div className="mt-8 space-y-4 rounded-xl border border-neutral-800 bg-neutral-950/80 p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">In-app updates</h2>
          {error && (
            <p className="text-sm text-amber-600/90">
              Could not load update manifest: {error}. Ensure <code className="text-neutral-400">version.json</code> is
              deployed.
            </p>
          )}
          {!error && !manifest && (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading manifest…
            </div>
          )}
          {manifest && (
            <>
              <p className="text-sm text-neutral-400">
                Latest listed version: <span className="font-mono text-neutral-200">{manifest.version}</span>
                {manifest.notes ? ` — ${manifest.notes}` : null}
              </p>
              {manifest.url ? (
                <a
                  href={manifest.url}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800"
                >
                  <Download className="h-4 w-4" />
                  Update archive (tar.gz)
                </a>
              ) : null}
            </>
          )}
          <a
            href="/code-scout/download/version.json"
            className="inline-flex items-center gap-2 text-xs text-neutral-500 hover:text-neutral-400"
          >
            <FileJson className="h-3.5 w-3.5" />
            version.json
          </a>
        </div>
      </div>
    </div>
  );
}
