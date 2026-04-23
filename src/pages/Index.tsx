import { useState, useEffect, useRef } from 'react';
import { X, Bot, FileText, ListOrdered, ChevronUp, ChevronDown, Terminal, FlaskConical, Globe, Undo2, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import TopBar from '@/components/workbench/TopBar';
import FileTree from '@/components/workbench/FileTree';
import TokenPowerGrid from '@/components/workbench/TokenPowerGrid';
import EditorPanel from '@/components/workbench/EditorPanel';
import AIPanel from '@/components/workbench/AIPanel';
import PlanTabPanel from '@/components/workbench/PlanTabPanel';
import TerminalPanel from '@/components/workbench/TerminalPanel';
import ModelSettings from '@/components/workbench/ModelSettings';
import SessionSidebar from '@/components/workbench/SessionSidebar';
import BenchmarkPanel from '@/components/workbench/BenchmarkPanel';
import WebPanel from '@/components/workbench/WebPanel';
import ProjectLauncher from '@/pages/ProjectLauncher';
import WelcomeScreen from '@/pages/WelcomeScreen';
import { useWorkbenchStore, CENTER_TAB_PLAN, CENTER_TAB_BENCHMARK } from '@/store/workbenchStore';
import { useModeStore } from '@/store/modeStore';

const CENTER_TAB_WEB = ':web';
import { useProjectStore } from '@/store/projectStore';
import { useChatHistoryStore } from '@/store/chatHistoryStore';
import { syncWorkbenchRootFromActiveProject } from '@/lib/syncWorkbenchFromProject';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import type { ImperativePanelHandle } from 'react-resizable-panels';

function fileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const colors: Record<string, string> = {
    tsx: 'text-info', ts: 'text-info',
    jsx: 'text-warning', js: 'text-warning',
    css: 'text-accent', json: 'text-success',
  };
  return colors[ext || ''] || 'text-muted-foreground';
}

const Index = () => {
  const {
    openFiles,
    activeFile,
    activeCenterTab,
    setActiveCenterTab,
    closeFile,
    currentPlan,
    planTabOpen,
    closePlanTab,
    fileHistory,
    rollbackFile,
    addLog,
  } = useWorkbenchStore();
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const webModeEnabled = useModeStore(s => s.webModeEnabled);
  const hydrateWorkbenchForProject = useChatHistoryStore(s => s.hydrateWorkbenchForProject);
  const chatHistoryHydrated = useChatHistoryStore(s => s._hasHydrated);
  const lastHydratedProjectRef = useRef<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(
    () => localStorage.getItem('scout-welcomed') !== 'true'
  );
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    if (!activeProjectId) {
      lastHydratedProjectRef.current = null;
      return;
    }
    // Wait for Zustand persist to rehydrate chatsByProject from localStorage before
    // running hydrateWorkbenchForProject — otherwise it sees an empty store, sets welcome
    // state, and marks the project as done, so real sessions never get restored.
    if (!chatHistoryHydrated) return;
    if (lastHydratedProjectRef.current === activeProjectId) return;
    lastHydratedProjectRef.current = activeProjectId;
    hydrateWorkbenchForProject(activeProjectId);
  }, [activeProjectId, hydrateWorkbenchForProject, chatHistoryHydrated]);

  // Persisted project folder → workbench tree + terminal cwd + agent root (workbench is not persisted).
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    void syncWorkbenchRootFromActiveProject(activeProjectId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  if (!activeProjectId) {
    return (
      <>
        {showWelcome && (
          <WelcomeScreen onClose={() => {
            localStorage.setItem('scout-welcomed', 'true');
            setShowWelcome(false);
          }} />
        )}
        <ProjectLauncher />
      </>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <ModelSettings />
      <TopBar />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar toggle */}
        <button
          onClick={() => setLeftSidebarCollapsed(c => !c)}
          className="flex items-center justify-center w-5 shrink-0 border-r border-border bg-surface-panel hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
          title={leftSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          {leftSidebarCollapsed
            ? <PanelLeftOpen className="h-3.5 w-3.5" />
            : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>

        {/* Left — Session Sidebar (collapsible) */}
        <div
          className={`shrink-0 border-r border-border overflow-hidden transition-all duration-200 ${
            leftSidebarCollapsed ? 'w-0' : 'w-56'
          }`}
        >
          <SessionSidebar />
        </div>

        {/* Center + Right — resizable panels */}
        <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Center — Tab bar + content + terminal */}
        <ResizablePanel defaultSize={75} minSize={30} className="flex flex-col overflow-hidden min-w-0">
          {/* Tab bar */}
          <div className="flex items-center border-b border-border shrink-0 bg-surface-panel overflow-x-auto">
            {/* Code Agent tab — permanent */}
            <button
              onClick={() => setActiveCenterTab('chat')}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border shrink-0 transition-colors ${
                activeCenterTab === 'chat'
                  ? 'bg-card text-foreground border-b border-b-card'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
              }`}
            >
              <Bot className="h-3 w-3" />
              Code Agent
            </button>

            {/* Web tab — visible when web mode is enabled */}
            {webModeEnabled && (
              <button
                onClick={() => setActiveCenterTab(CENTER_TAB_WEB)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border shrink-0 transition-colors ${
                  activeCenterTab === CENTER_TAB_WEB
                    ? 'bg-card text-foreground border-b border-b-card'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                <Globe className="h-3 w-3 text-amber-500" />
                Web
              </button>
            )}

            {currentPlan && planTabOpen && (
              <div
                className={`group flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border cursor-pointer shrink-0 transition-colors ${
                  activeCenterTab === CENTER_TAB_PLAN
                    ? 'bg-card text-foreground border-b border-b-card'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                }`}
                onClick={() => setActiveCenterTab(CENTER_TAB_PLAN)}
              >
                <ListOrdered className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate max-w-[120px]">Plan</span>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    closePlanTab();
                  }}
                  className="opacity-0 group-hover:opacity-100 rounded hover:text-destructive transition-all ml-0.5"
                  title="Close plan tab"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* File tabs — exclude reserved tab identifiers */}
            {openFiles.filter(f => !f.startsWith(':')).map(filePath => {
              const name = filePath.split('/').pop() || filePath;
              const isActive = activeCenterTab === filePath;
              const snapshot = fileHistory.find(s => s.path === filePath);
              const isChanged = !!snapshot;
              return (
                <div
                  key={filePath}
                  className={`group flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border cursor-pointer shrink-0 transition-colors ${
                    isActive
                      ? 'bg-card text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                  }`}
                  onClick={() => setActiveCenterTab(filePath)}
                >
                  <FileText className={`h-3 w-3 shrink-0 ${fileIcon(name)}`} />
                  <span className="truncate max-w-[100px]">{name}</span>
                  {isChanged && snapshot?.action === 'created' && (
                    <span className="text-[9px] font-bold text-success" title="New file">N</span>
                  )}
                  {isChanged && snapshot?.action === 'edited' && (
                    <span className="text-[9px] font-bold text-primary" title="Modified">M</span>
                  )}
                  {isChanged && (
                    <button
                      onClick={e => { e.stopPropagation(); rollbackFile(filePath); addLog(`Rolled back: ${filePath}`, 'warning'); }}
                      title="Rollback changes"
                      className="opacity-0 group-hover:opacity-100 hover:bg-warning/20 rounded p-0.5 transition-opacity text-muted-foreground hover:text-warning"
                    >
                      <Undo2 className="h-3 w-3" />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); closeFile(filePath); }}
                    className="opacity-0 group-hover:opacity-100 rounded hover:text-destructive transition-all ml-0.5"
                    title="Close tab"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Content area — keep AIPanel always mounted so chat state is never lost */}
          <div className="flex-1 overflow-hidden min-h-0 relative">
            {/* AIPanel stays in the DOM at all times; hidden via CSS when another tab is active */}
            <div className={`absolute inset-0 ${activeCenterTab === 'chat' ? '' : 'invisible pointer-events-none'}`}>
              <AIPanel />
            </div>
            {/* All panels stay mounted so local state survives tab switches */}
            <div className={`absolute inset-0 ${activeCenterTab === CENTER_TAB_PLAN ? '' : 'invisible pointer-events-none'}`}>
              <PlanTabPanel />
            </div>
            {webModeEnabled && (
              <div className={`absolute inset-0 ${activeCenterTab === CENTER_TAB_WEB ? '' : 'invisible pointer-events-none'}`}>
                <WebPanel />
              </div>
            )}
            <div className={`absolute inset-0 z-10 flex flex-col bg-card ${activeCenterTab === CENTER_TAB_BENCHMARK ? '' : 'invisible pointer-events-none'}`}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-panel shrink-0">
                <FlaskConical className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-foreground">Benchmark</span>
                <button
                  onClick={() => setActiveCenterTab('chat')}
                  className="ml-auto p-1 rounded hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
                  title="Close benchmark"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <BenchmarkPanel />
              </div>
            </div>
            <div className={`absolute inset-0 ${activeCenterTab !== 'chat' && activeCenterTab !== CENTER_TAB_PLAN && activeCenterTab !== CENTER_TAB_WEB && activeCenterTab !== CENTER_TAB_BENCHMARK ? '' : 'invisible pointer-events-none'}`}>
              <EditorPanel />
            </div>
          </div>

          {/* Terminal — collapsible */}
          <div className="shrink-0 border-t border-border">
            <button
              onClick={() => setTerminalCollapsed(prev => !prev)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
              title={terminalCollapsed ? 'Show terminal' : 'Hide terminal'}
            >
              <Terminal className="h-3 w-3" />
              <span className="font-medium">Terminal</span>
              {terminalCollapsed
                ? <ChevronUp className="h-3 w-3 ml-auto" />
                : <ChevronDown className="h-3 w-3 ml-auto" />
              }
            </button>
            <div
              className="overflow-hidden transition-all duration-200"
              style={{
                height: terminalCollapsed ? 0 : '30dvh',
                minHeight: terminalCollapsed ? 0 : 160,
                maxHeight: terminalCollapsed ? 0 : '50dvh',
              }}
            >
              <TerminalPanel />
            </div>
          </div>
        </ResizablePanel>

        {/* Right — File tree, resizable and collapsible */}
        <ResizableHandle withHandle className={rightPanelCollapsed ? 'hidden' : ''} />
        <ResizablePanel
          ref={rightPanelRef}
          defaultSize={25}
          minSize={0}
          collapsible
          collapsedSize={0}
          onCollapse={() => setRightPanelCollapsed(true)}
          onExpand={() => setRightPanelCollapsed(false)}
          className="border-l border-border overflow-hidden"
        >
          <div className="h-full flex flex-col overflow-hidden">
            {/* Token Power Grid — collapsible, auto height */}
            <div className="shrink-0">
              <TokenPowerGrid />
            </div>
            {/* File tree — takes remaining space, scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <FileTree />
            </div>
          </div>
        </ResizablePanel>
        </ResizablePanelGroup>

        {/* Collapse / expand toggle — always visible at far right, outside panel group */}
        <button
          onClick={() => {
            if (rightPanelCollapsed) {
              rightPanelRef.current?.expand();
            } else {
              rightPanelRef.current?.collapse();
            }
          }}
          className="flex items-center justify-center w-5 shrink-0 border-l border-border bg-surface-panel hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
          title={rightPanelCollapsed ? 'Show file tree' : 'Hide file tree'}
        >
          {rightPanelCollapsed
            ? <PanelRightOpen className="h-3.5 w-3.5" />
            : <PanelRightClose className="h-3.5 w-3.5" />
          }
        </button>
      </div>
    </div>
  );
};

export default Index;
