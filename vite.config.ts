import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://v2.tauri.app/start/frontend/vite/
const tauriHost = process.env.TAURI_DEV_HOST;
const isTauriCli = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig(({ mode }) => {
  // Packaged WebView: relative asset URLs. Only for production — `tauri dev` stays on "/".
  const base = isTauriCli && mode === "production" ? "./" : "/";

  return {
    base,
    clearScreen: false,
    envPrefix: ["VITE_", "TAURI_ENV_*"],
    server: {
      host: tauriHost || "::",
      port: Number(process.env.PORT) || 8080,
      strictPort: true,
      hmr: tauriHost
        ? { protocol: "ws", host: tauriHost, port: 1421 }
        : { overlay: false },
      watch: { ignored: ["**/src-tauri/**"] },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    build: {
      target:
        process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari16",
      minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
      sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
      /** Main chunk is ~1.4MB — default 500kB warning is noise until we code-split. */
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          const msg = typeof warning.message === "string" ? warning.message : "";
          // Mixed static + dynamic import of the same module — bundle still valid; Rollup cannot lazy-split.
          if (msg.includes("dynamic import will not move module into another chunk")) return;
          defaultHandler(warning);
        },
      },
    },
  };
});
