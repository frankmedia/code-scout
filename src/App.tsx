import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import { useModelStore } from "@/store/modelStore";

// ─── Root Error Boundary ──────────────────────────────────────────────────────
// Catches any unhandled React render/lifecycle error and shows a readable
// recovery screen instead of a blank black page.

interface ErrorBoundaryState { error: Error | null; info: ErrorInfo | null }

class RootErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error('[RootErrorBoundary]', error, info.componentStack);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d0d0d', color: '#e5e5e5', fontFamily: 'monospace',
        padding: '2rem', gap: '1rem',
      }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f87171' }}>
          Something went wrong
        </div>
        <div style={{
          maxWidth: 700, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
          padding: '1rem', fontSize: '0.8rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          <span style={{ color: '#f87171' }}>{error.message}</span>
          {info?.componentStack && (
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', color: '#9ca3af' }}>Component stack</summary>
              <div style={{ marginTop: '0.5rem', color: '#6b7280', fontSize: '0.72rem' }}>
                {info.componentStack}
              </div>
            </details>
          )}
        </div>
        <button
          onClick={() => this.setState({ error: null, info: null })}
          style={{
            marginTop: '0.5rem', padding: '0.5rem 1.25rem', borderRadius: 6,
            background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.8rem',
          }}
        >
          Try to recover
        </button>
      </div>
    );
  }
}

// ─── Startup stats refresh ────────────────────────────────────────────────────
// Runs once when the app mounts. Refreshes all enabled models that haven't
// been refreshed in the last 10 minutes, staggered to avoid API rate limits.

function useStartupModelRefresh() {
  const refreshAllEnabledModels = useModelStore(s => s.refreshAllEnabledModels);
  useEffect(() => {
    // Small delay so Zustand persist can rehydrate before we start fetching
    const t = setTimeout(() => refreshAllEnabledModels(10 * 60 * 1000), 1500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ─── App ──────────────────────────────────────────────────────────────────────

const queryClient = new QueryClient();

function AppInner() {
  useStartupModelRefresh();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

const App = () => (
  <RootErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AppInner />
      </TooltipProvider>
    </QueryClientProvider>
  </RootErrorBoundary>
);

export default App;
