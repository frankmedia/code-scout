/**
 * WebPanel.tsx — Browser automation interface
 *
 * Provides a chat-like interface for controlling a browser via Playwright.
 * Uses a REACTIVE AGENT LOOP: observe → think → act → repeat
 * UI matches the coding mode's plan card style.
 */

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react';
import {
  Send,
  Globe,
  Loader2,
  Play,
  Square,
  ExternalLink,
  Camera,
  X,
  AlertCircle,
  CheckCircle2,
  Circle,
  MousePointer,
  Type,
  FileText,
  Link2,
  Map,
  Download,
  Image,
  FormInput,
  FolderOpen,
} from 'lucide-react';
import { useModeStore } from '@/store/modeStore';
import { useModelStore } from '@/store/modelStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { useActivityStore } from '@/store/activityStore';
import { useWebSessionStore } from '@/store/webSessionStore';
import { useProjectStore } from '@/store/projectStore';
import {
  launchBrowser,
  closeBrowser,
  browserGoto,
  browserScreenshot,
  getBrowserStatus,
  isBrowserAgentRunning,
  startBrowserAgent,
} from '@/services/browserService';
import { runWebAgentLoop, type WebAgentAction } from '@/services/webAgentLoop';
import { initWebFolder, getSavedWebFiles, subscribeSavedWebFiles, type WebSavedFile } from '@/services/browserExecutor';
import { ChatMarkdown } from './ChatMarkdown';

// Action icons matching coding mode style
const ACTION_ICONS: Record<string, React.ReactNode> = {
  browser_launch: <Play className="h-3 w-3" />,
  browser_goto: <Globe className="h-3 w-3" />,
  browser_click: <MousePointer className="h-3 w-3" />,
  browser_fill: <Type className="h-3 w-3" />,
  browser_extract: <FileText className="h-3 w-3" />,
  browser_screenshot: <Camera className="h-3 w-3" />,
  browser_scroll: <FileText className="h-3 w-3" />,
  browser_wait: <Loader2 className="h-3 w-3" />,
  browser_close: <Square className="h-3 w-3" />,
  detect_form: <FormInput className="h-3 w-3" />,
  get_links: <Link2 className="h-3 w-3" />,
  crawl: <Globe className="h-3 w-3" />,
  sitemap: <Map className="h-3 w-3" />,
  save_json: <Download className="h-3 w-3" />,
  save_csv: <Download className="h-3 w-3" />,
  save_markdown: <Download className="h-3 w-3" />,
  save_screenshot: <Image className="h-3 w-3" />,
  done: <CheckCircle2 className="h-3 w-3" />,
};

interface WebStep {
  id: string;
  action: string;
  description: string;
  detail?: string; // URL, selector, value, etc.
  output?: string; // Full output from the action (for detect_form, extract, etc.)
  status: 'pending' | 'running' | 'done' | 'error';
  reason?: string;
}

interface WebTaskCard {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  steps: WebStep[];
  result?: string;
  screenshot?: string;
  thinking?: string; // Current thinking/processing status
}

interface WebMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  screenshot?: string;
  taskCard?: WebTaskCard;
}

function StepIcon({ status }: { status: WebStep['status'] }) {
  switch (status) {
    case 'pending':
      return <Circle className="h-3 w-3 text-muted-foreground" />;
    case 'running':
      return <Loader2 className="h-3 w-3 text-primary animate-spin" />;
    case 'done':
      return <CheckCircle2 className="h-3 w-3 text-green-500" />;
    case 'error':
      return <AlertCircle className="h-3 w-3 text-destructive" />;
  }
}

// Actions that have detailed output worth showing
const EXPANDABLE_ACTIONS = ['detect_form', 'browser_extract', 'get_links', 'crawl', 'sitemap'];

function StepRow({ step }: { step: WebStep }) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = step.output && step.output.length > 0;
  const isExpandable = hasOutput && EXPANDABLE_ACTIONS.includes(step.action);
  
  return (
    <div className={`border-b border-border/30 last:border-b-0 ${step.status === 'running' ? 'bg-primary/5' : ''}`}>
      <div 
        className={`flex items-start gap-2 px-3 py-1.5 ${isExpandable ? 'cursor-pointer hover:bg-secondary/30' : ''}`}
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        <div className="mt-0.5 shrink-0">
          <StepIcon status={step.status} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground shrink-0">
              {ACTION_ICONS[step.action] || <Globe className="h-3 w-3" />}
            </span>
            <span className="text-[11px] text-foreground truncate">
              {step.description}
            </span>
            {isExpandable && (
              <span className="text-[9px] text-muted-foreground">
                {expanded ? '▼' : '▶'}
              </span>
            )}
          </div>
          {step.detail && !expanded && (
            <p className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
              {step.detail}
            </p>
          )}
        </div>
      </div>
      
      {/* Expanded output with markdown rendering */}
      {expanded && hasOutput && (
        <div className="px-3 py-2 bg-secondary/20 border-t border-border/20">
          <div className="text-xs prose prose-sm dark:prose-invert max-w-none overflow-x-auto">
            <ChatMarkdown content={step.output!} />
          </div>
        </div>
      )}
    </div>
  );
}

const WELCOME_MESSAGES: WebMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: '🌐 **Web Automation**\n\nI control a browser step-by-step, adapting to what I find on each page. Tell me a URL and what you need — I\'ll handle navigation, extraction, form filling, and saving results.',
    timestamp: Date.now(),
  },
];

const WebPanel = () => {
  const [messages, setMessages] = useState<WebMessage[]>(WELCOME_MESSAGES);
  const [input, setInput] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const taskRunningRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    browserActive,
    setBrowserActive,
    currentBrowserUrl,
    setCurrentBrowserUrl,
    currentBrowserTitle,
    setCurrentBrowserTitle,
    setLastScreenshot,
    setWebModeEnabled,
  } = useModeStore();

  const getActiveModel = useModelStore(s => s.getModelForRole);
  const setSettingsOpen = useModelStore(s => s.setSettingsOpen);
  const setActiveCenterTab = useWorkbenchStore(s => s.setActiveCenterTab);
  const openFileInEditor = useWorkbenchStore(s => s.openFile);
  const addAiSessionTokens = useWorkbenchStore(s => s.addAiSessionTokens);
  const recordTokens = useActivityStore(s => s.recordTokens);

  const savedWebFiles = useSyncExternalStore(subscribeSavedWebFiles, getSavedWebFiles);
  
  // Web session tracking
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const { createSession, updateSession, saveMessages: saveSessionMessages, getMessages: getSessionMessages } = useWebSessionStore();
  const activeWebSessionId = useWebSessionStore(s =>
    activeProjectId ? (s.activeSessionByProject[activeProjectId] ?? null) : null,
  );
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const [webSessionTokens, setWebSessionTokens] = useState({ 
    orchestratorIn: 0, orchestratorOut: 0,
    coderIn: 0, coderOut: 0 
  });
  
  // For wait_for_user action - shows a prompt and waits for user to continue
  const [userPrompt, setUserPrompt] = useState<{ message: string; resolve: () => void } | null>(null);
  const [savedFilesOpen, setSavedFilesOpen] = useState(false);

  // Load saved messages when user clicks a PAST session in the sidebar.
  // This effect ONLY runs when activeWebSessionId changes AND is different
  // from what we're already showing. It never touches a running task.
  const prevWebSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const sid = activeWebSessionId;
    // Skip if same session we already processed
    if (sid === prevWebSessionIdRef.current) return;
    prevWebSessionIdRef.current = sid;

    // Never interfere with a running task
    if (taskRunningRef.current || activeTaskId) return;

    if (!activeProjectId || !sid) {
      setMessages(WELCOME_MESSAGES);
      setCurrentSessionId(null);
      return;
    }

    const saved = getSessionMessages(activeProjectId, sid);
    if (saved.length > 0) {
      setMessages(saved as WebMessage[]);
      setCurrentSessionId(sid);
    }
  }, [activeWebSessionId, activeProjectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-save messages to session store while task is running (debounced)
  useEffect(() => {
    if (!activeProjectId || !currentSessionId || !activeTaskId) return;
    const timer = setTimeout(() => {
      saveSessionMessages(activeProjectId, currentSessionId, messages as import('@/store/webSessionStore').WebSessionMessage[]);
    }, 2000);
    return () => clearTimeout(timer);
  }, [messages, activeProjectId, currentSessionId, activeTaskId]);

  // Initialize .codescout_web folder when web mode is opened or project changes
  const projectPath = useWorkbenchStore(s => s.projectPath);
  useEffect(() => {
    initWebFolder().catch((err) => {
      console.warn('[WebPanel] Failed to initialize .codescout_web folder:', err);
    });
  }, [projectPath]);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        if (!isBrowserAgentRunning()) {
          setBrowserActive(false);
          return;
        }
        const status = await getBrowserStatus();
        setBrowserActive(status.browserRunning);
        setCurrentBrowserUrl(status.currentUrl);
        setCurrentBrowserTitle(status.currentTitle);
      } catch {
        setBrowserActive(false);
      }
    };
    checkStatus();
  }, [setBrowserActive, setCurrentBrowserUrl, setCurrentBrowserTitle]);

  const addMessage = useCallback((msg: Omit<WebMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [
      ...prev,
      { ...msg, id: crypto.randomUUID(), timestamp: Date.now() },
    ]);
  }, []);

  const updateTaskCard = useCallback((taskId: string, update: Partial<WebTaskCard>) => {
    setMessages(prev => prev.map(msg => {
      if (msg.taskCard?.id === taskId) {
        return { ...msg, taskCard: { ...msg.taskCard, ...update } };
      }
      return msg;
    }));
  }, []);

  const addStepToTask = useCallback((taskId: string, step: WebStep) => {
    setMessages(prev => prev.map(msg => {
      if (msg.taskCard?.id === taskId) {
        return { 
          ...msg, 
          taskCard: { 
            ...msg.taskCard, 
            steps: [...msg.taskCard.steps, step] 
          } 
        };
      }
      return msg;
    }));
  }, []);

  const updateStepInTask = useCallback((taskId: string, stepId: string, update: Partial<WebStep>) => {
    setMessages(prev => prev.map(msg => {
      if (msg.taskCard?.id === taskId) {
        return { 
          ...msg, 
          taskCard: { 
            ...msg.taskCard, 
            steps: msg.taskCard.steps.map(s => s.id === stepId ? { ...s, ...update } : s)
          } 
        };
      }
      return msg;
    }));
  }, []);

  const handleLaunchBrowser = async () => {
    addMessage({ role: 'system', content: '🚀 Starting browser...' });
    try {
      await startBrowserAgent((status) => {
        // Update the last system message with current setup status
        addMessage({ role: 'system', content: `⏳ ${status}` });
      });
      const result = await launchBrowser(false);
      if (result.success) {
        setBrowserActive(true);
        addMessage({ role: 'system', content: '✅ Browser ready!' });
      } else {
        addMessage({ role: 'system', content: `❌ ${result.error}` });
      }
    } catch (err) {
      addMessage({ role: 'system', content: `❌ ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const handleCloseBrowser = async () => {
    try {
      await closeBrowser();
      setBrowserActive(false);
      setCurrentBrowserUrl(null);
      setCurrentBrowserTitle(null);
      addMessage({ role: 'system', content: '✅ Browser closed.' });
    } catch (err) {
      addMessage({ role: 'system', content: `❌ ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const handleScreenshot = async () => {
    if (!browserActive) return;
    try {
      const result = await browserScreenshot();
      if (result.success && result.screenshot) {
        setLastScreenshot(result.screenshot);
        addMessage({ role: 'system', content: '📸 Screenshot captured', screenshot: result.screenshot });
      }
    } catch {}
  };

  const handleGotoUrl = async () => {
    const url = prompt('Enter URL:', 'https://');
    if (!url) return;
    if (!browserActive) await handleLaunchBrowser();
    try {
      const result = await browserGoto(url);
      if (result.success) {
        setCurrentBrowserUrl(result.url ?? url);
        setCurrentBrowserTitle(result.title ?? null);
        addMessage({ role: 'system', content: `✅ Loaded: ${result.title ?? url}` });
      }
    } catch {}
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || activeTaskId) return;

    setInput('');
    addMessage({ role: 'user', content: text });

    const model = getActiveModel('orchestrator');
    if (!model?.enabled) {
      addMessage({ role: 'system', content: '⚠️ No orchestrator model configured.' });
      return;
    }

    if (!isBrowserAgentRunning()) {
      addMessage({ role: 'system', content: '🚀 Starting browser agent...' });
      try {
        await startBrowserAgent((status) => {
          addMessage({ role: 'system', content: `⏳ ${status}` });
        });
      } catch (err) {
        addMessage({ role: 'system', content: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
    }

    const taskId = crypto.randomUUID();
    abortControllerRef.current = new AbortController();
    taskRunningRef.current = true;

    // Create the task card BEFORE creating the session,
    // so messages exist before the session-load effect fires.
    const taskCard: WebTaskCard = {
      id: taskId,
      task: text,
      status: 'running',
      steps: [],
    };

    addMessage({ 
      role: 'assistant', 
      content: '', 
      taskCard 
    });

    // Mark task as running — this guards the session-load effect
    setActiveTaskId(taskId);

    // Create session in store for sidebar LAST so the effect
    // sees activeTaskId and skips the message reload.
    let sessionId: string | null = null;
    if (activeProjectId) {
      sessionId = createSession(activeProjectId, text);
      setCurrentSessionId(sessionId);
    }

    let currentStepId: string | null = null;
    let stepCount = 0;

    try {
      await runWebAgentLoop(text, {
        onStateChange: (state) => {
          setBrowserActive(state.browserRunning);
          if (state.currentUrl) setCurrentBrowserUrl(state.currentUrl);
          if (state.currentTitle) setCurrentBrowserTitle(state.currentTitle);
        },

        onAction: (action: WebAgentAction) => {
          const stepId = crypto.randomUUID();
          currentStepId = stepId;
          stepCount++;
          
          const detail = action.url || action.selector || action.value || action.path || '';
          
          addStepToTask(taskId, {
            id: stepId,
            action: action.action,
            description: action.reason || action.action,
            detail: detail,
            status: 'running',
            reason: action.reason,
          });
          
          // Update step count in session
          if (activeProjectId && sessionId) {
            updateSession(activeProjectId, sessionId, { stepsCount: stepCount });
          }
        },

        onActionComplete: (action, result) => {
          // Store the output in the step
          if (currentStepId) {
            updateStepInTask(taskId, currentStepId, { 
              status: result.success ? 'done' : 'error',
              output: result.output 
            });
          }
        },

        onThinking: (thought) => {
          // Show thinking status (especially useful for Coder analysis)
          updateTaskCard(taskId, { thinking: thought });
        },

        onComplete: (answer) => {
          if (currentStepId) {
            updateStepInTask(taskId, currentStepId, { status: 'done' });
          }
          updateTaskCard(taskId, { status: 'done', result: answer, thinking: undefined });
          
          // Update session in store
          if (activeProjectId && sessionId) {
            updateSession(activeProjectId, sessionId, { 
              status: 'done',
              url: currentBrowserUrl || undefined,
            });
          }
          
          browserScreenshot().then(result => {
            if (result.success && result.screenshot) {
              setLastScreenshot(result.screenshot);
              updateTaskCard(taskId, { screenshot: result.screenshot });
            }
          }).catch(() => {});
        },

        onError: (error) => {
          if (currentStepId) {
            updateStepInTask(taskId, currentStepId, { status: 'error' });
          }
          updateTaskCard(taskId, { status: 'error', result: error });
          
          // Update session in store
          if (activeProjectId && sessionId) {
            updateSession(activeProjectId, sessionId, { status: 'error' });
          }
        },

        trackTokens: (input, output, role) => {
          addAiSessionTokens(input + output, role);
          recordTokens(role, input, output);
          setWebSessionTokens(prev => 
            role === 'coder' 
              ? { ...prev, coderIn: prev.coderIn + input, coderOut: prev.coderOut + output }
              : { ...prev, orchestratorIn: prev.orchestratorIn + input, orchestratorOut: prev.orchestratorOut + output }
          );
        },

        onWaitForUser: (message) => {
          return new Promise<void>((resolve) => {
            setUserPrompt({ message, resolve });
          });
        },
      }, abortControllerRef.current.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        updateTaskCard(taskId, { status: 'stopped', result: 'Stopped by user' });
        // Update session in store
        if (activeProjectId && sessionId) {
          updateSession(activeProjectId, sessionId, { status: 'stopped' });
        }
      } else {
        updateTaskCard(taskId, { status: 'error', result: err instanceof Error ? err.message : String(err) });
        // Update session in store
        if (activeProjectId && sessionId) {
          updateSession(activeProjectId, sessionId, { status: 'error' });
        }
      }
    } finally {
      setActiveTaskId(null);
      taskRunningRef.current = false;
      abortControllerRef.current = null;
      // Persist messages to session store
      if (activeProjectId && sessionId) {
        setMessages(prev => {
          saveSessionMessages(activeProjectId, sessionId, prev as import('@/store/webSessionStore').WebSessionMessage[]);
          return prev;
        });
      }
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const isRunning = !!activeTaskId;

  const hasOrchestrator = !!getActiveModel('orchestrator')?.enabled;
  const hasCoder = !!getActiveModel('coder')?.enabled;
  const missingRoles = !hasOrchestrator || !hasCoder;

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-surface-panel px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Web Automation</span>
            {browserActive ? (
              <span className="flex items-center gap-1 text-xs text-green-500">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Active
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Inactive</span>
            )}

            {(webSessionTokens.orchestratorIn > 0 || webSessionTokens.coderIn > 0) && (
              <div className="ml-2 flex items-center gap-1 text-[10px] font-mono">
                {webSessionTokens.orchestratorIn > 0 && (
                  <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 rounded" title="Orchestrator (paid)">
                    🎯 {((webSessionTokens.orchestratorIn + webSessionTokens.orchestratorOut) / 1000).toFixed(1)}k
                  </span>
                )}
                {webSessionTokens.coderIn > 0 && (
                  <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 rounded" title="Coder (free)">
                    🆓 {((webSessionTokens.coderIn + webSessionTokens.coderOut) / 1000).toFixed(1)}k
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {!browserActive ? (
              <button onClick={handleLaunchBrowser} className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90">
                <Play className="h-3 w-3" /> Launch
              </button>
            ) : (
              <>
                <button onClick={handleGotoUrl} className="p-1.5 text-xs bg-secondary rounded hover:bg-secondary/80" title="Go to URL">
                  <ExternalLink className="h-3 w-3" />
                </button>
                <button onClick={handleScreenshot} className="p-1.5 text-xs bg-secondary rounded hover:bg-secondary/80" title="Screenshot">
                  <Camera className="h-3 w-3" />
                </button>
                <button onClick={handleCloseBrowser} className="p-1.5 text-xs bg-destructive/10 text-destructive rounded hover:bg-destructive/20" title="Close">
                  <Square className="h-3 w-3" />
                </button>
              </>
            )}
            <button 
              onClick={() => { 
                setWebModeEnabled(false); 
                setActiveCenterTab('chat');
                // Clear messages and reset session
                setMessages([
                  { id: 'welcome', role: 'assistant', content: '', timestamp: Date.now() }
                ]);
                setWebSessionTokens({ orchestratorIn: 0, orchestratorOut: 0, coderIn: 0, coderOut: 0 });
                setCurrentSessionId(null);
              }} 
              className="ml-2 p-1 text-muted-foreground hover:text-foreground" 
              title="Close Web Mode"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {browserActive && currentBrowserUrl && (
          <div className="mt-1 text-xs text-muted-foreground truncate">
            {currentBrowserUrl} {currentBrowserTitle && `— ${currentBrowserTitle}`}
          </div>
        )}
        
        {/* File save location hint */}
        <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <Download className="h-2.5 w-2.5" />
          <span>Data → <code className="px-0.5 bg-secondary/50 rounded">.codescout_web/</code></span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
            {msg.taskCard ? (
              // Task Card - full width responsive
              <div className="w-full rounded-lg border border-border bg-secondary/30 overflow-hidden">
                {/* Card header */}
                <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-border/50 bg-secondary/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {msg.taskCard.status === 'running' && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />}
                      {msg.taskCard.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                      {msg.taskCard.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                      {msg.taskCard.status === 'stopped' && <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="text-xs font-medium text-foreground truncate">
                        {msg.taskCard.task}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {msg.taskCard.steps.length} step{msg.taskCard.steps.length !== 1 ? 's' : ''}
                      {msg.taskCard.status === 'running' && ' · Running...'}
                      {msg.taskCard.status === 'done' && ' · Complete'}
                      {msg.taskCard.status === 'error' && ' · Failed'}
                    </div>
                  </div>
                  {msg.taskCard.status === 'running' && (
                    <button onClick={handleStop} className="flex items-center gap-1 px-2 py-1 text-[10px] bg-destructive/10 text-destructive rounded hover:bg-destructive/20">
                      <Square className="h-2.5 w-2.5" /> Stop
                    </button>
                  )}
                </div>

                {/* Steps list */}
                <div className="max-h-[50vh] overflow-y-auto">
                  {msg.taskCard.steps.map(step => (
                    <StepRow key={step.id} step={step} />
                  ))}
                </div>

                {/* Thinking indicator (shows Coder analysis, etc.) */}
                {msg.taskCard.thinking && msg.taskCard.status === 'running' && (
                  <div className="px-3 py-1.5 border-t border-border/30 bg-cyan-500/5 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 text-cyan-400 animate-spin" />
                    <span className="text-[10px] text-cyan-400">{msg.taskCard.thinking}</span>
                  </div>
                )}

                {/* Result */}
                {msg.taskCard.result && (
                  <div className={`px-3 py-2 border-t border-border/50 text-sm prose prose-sm dark:prose-invert max-w-none ${
                    msg.taskCard.status === 'error' ? 'bg-destructive/5 text-destructive' : 'bg-green-500/5 text-foreground'
                  }`}>
                    <ChatMarkdown content={msg.taskCard.result} />
                  </div>
                )}

                {/* Screenshot */}
                {msg.taskCard.screenshot && (
                  <div className="p-2 border-t border-border/50">
                    <img
                      src={`data:image/png;base64,${msg.taskCard.screenshot}`}
                      alt="Result"
                      className="rounded border border-border max-w-full"
                    />
                  </div>
                )}
              </div>
            ) : (
              // Regular message - user messages are compact, assistant messages are full width
              <div className={`rounded-lg px-3 py-2 ${
                msg.role === 'user'
                  ? 'max-w-[85%] bg-primary text-primary-foreground'
                  : msg.role === 'system'
                  ? 'max-w-[85%] bg-muted text-muted-foreground text-xs'
                  : 'w-full bg-secondary text-foreground'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                    <ChatMarkdown content={msg.content} />
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                )}
                {msg.screenshot && (
                  <img src={`data:image/png;base64,${msg.screenshot}`} alt="Screenshot" className="mt-2 rounded border border-border max-w-full" />
                )}
              </div>
            )}
          </div>
        ))}

        {isRunning && messages[messages.length - 1]?.taskCard?.steps.length === 0 && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-lg px-3 py-2 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Starting...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Saved files bar — collapsible */}
      {savedWebFiles.length > 0 && (
        <div className="shrink-0 border-t border-border bg-surface-panel/50">
          <button
            type="button"
            onClick={() => setSavedFilesOpen(p => !p)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground font-medium hover:bg-secondary/30 transition-colors"
          >
            <FolderOpen className="h-3 w-3" />
            Saved files ({savedWebFiles.length})
            <span className={`ml-auto transition-transform text-[8px] ${savedFilesOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>
          {savedFilesOpen && (
            <div className="max-h-24 overflow-y-auto px-3 pb-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {savedWebFiles.map(f => (
                  <button
                    key={f.absolutePath}
                    onClick={async () => {
                      try {
                        const { invoke } = await import('@tauri-apps/api/core');
                        const content = await invoke<string>('read_file_text', { path: f.absolutePath });
                        useWorkbenchStore.getState().createFile(f.filename, content);
                        openFileInEditor(f.filename);
                      } catch (err) {
                        console.warn('[WebPanel] Failed to open file:', err);
                      }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20 transition-colors"
                    title={f.absolutePath}
                  >
                    <FileText className="h-2.5 w-2.5" />
                    {f.filename}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-border bg-surface-panel p-3 space-y-2">
        {missingRoles && (
          <div className="flex items-start gap-2 py-2.5 px-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-amber-400">
                Select {!hasOrchestrator && !hasCoder ? 'an Orchestrator and a Coder' : !hasOrchestrator ? 'an Orchestrator' : 'a Coder'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Code Scout needs both an Orchestrator and a Coder model to work. Configure them in{' '}
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="underline text-primary hover:text-primary/80"
                >Settings</button>.
              </p>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !missingRoles) { e.preventDefault(); handleSend(); } }}
            placeholder={missingRoles ? 'Configure Orchestrator & Coder models to get started…' : isRunning ? "Task running..." : "What should I do in the browser?"}
            className="flex-1 min-h-[80px] max-h-40 bg-input text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/80 border border-border"
            disabled={isRunning || missingRoles}
          />
          <button
            onClick={isRunning ? handleStop : handleSend}
            disabled={missingRoles || (!isRunning && !input.trim())}
            className={`self-end p-2 rounded-lg ${isRunning ? 'bg-destructive text-white' : 'bg-primary text-white disabled:opacity-50'}`}
          >
            {isRunning ? <Square className="h-5 w-5" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* User Action Required Overlay */}
      {userPrompt && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border-2 border-amber-500 rounded-xl p-6 max-w-md mx-4 shadow-2xl animate-pulse-slow">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span className="text-2xl">✋</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-amber-400">Action Required</h3>
                <p className="text-xs text-muted-foreground">Complete this in the browser window</p>
              </div>
            </div>
            
            <div className="bg-secondary/50 rounded-lg p-4 mb-4">
              <p className="text-sm text-foreground">{userPrompt.message}</p>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>Waiting for you to complete the action...</span>
            </div>
            
            <button
              onClick={() => {
                userPrompt.resolve();
                setUserPrompt(null);
              }}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-lg transition-colors"
            >
              ✓ Done — Continue Automation
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WebPanel;
