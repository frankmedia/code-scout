import { useState, useRef, useEffect } from 'react';
import { Plus, X, Trash2, Terminal } from 'lucide-react';
import { useWorkbenchStore, type FileNode } from '@/store/workbenchStore';
import { isTauri, spawnCommand, getUserShell } from '@/lib/tauri';

const PROJECT_MARKERS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'Makefile', 'pom.xml', 'build.gradle'];
function resolveProjectRoot(path: string, files: FileNode[]): string {
  const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
  if (PROJECT_MARKERS.some(m => topFiles.includes(m))) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  const subdirs = files.filter(f => f.type === 'folder' && f.children);
  for (const dir of subdirs) {
    const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
    if (PROJECT_MARKERS.some(m => childFiles.includes(m))) return `${path}${sep}${dir.name}`;
  }
  if (subdirs.length === 1) return `${path}${sep}${subdirs[0].name}`;
  return path;
}

const TerminalPanel = () => {
  const {
    terminalTabs,
    activeTerminalId,
    terminalOutput,
    addTerminalOutput,
    clearTerminal,
    addTerminalTab,
    removeTerminalTab,
    setActiveTerminal,
    projectPath,
    projectName,
    files,
  } = useWorkbenchStore();

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [shellName, setShellName] = useState<string>('shell');
  const killRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalOutput]);

  // Focus input when tab changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeTerminalId]);

  // Detect user's login shell once
  useEffect(() => {
    if (isTauri()) {
      getUserShell().then(setShellName).catch(() => setShellName('zsh'));
    }
  }, []);

  const cwd = projectPath ? resolveProjectRoot(projectPath, files) : undefined;

  const handleSubmit = async () => {
    const cmd = input.trim();
    if (!cmd || running) return;

    addTerminalOutput(`$ ${cmd}`);
    setHistory(prev => [...prev, cmd]);
    setHistoryIndex(-1);
    setInput('');

    const lower = cmd.toLowerCase();

    // Built-ins (always work)
    if (lower === 'clear' || lower === 'cls') {
      clearTerminal();
      return;
    }

    if (lower === 'help') {
      addTerminalOutput('Built-in commands:');
      addTerminalOutput('  clear / cls  — Clear terminal');
      addTerminalOutput('  help         — This message');
      if (isTauri()) {
        addTerminalOutput('');
        addTerminalOutput(`All other commands run via your login shell (${shellName} -l -c).`);
        addTerminalOutput('Full PATH available: curl, git, npm, node, brew, etc.');
        addTerminalOutput('Press Ctrl+C to interrupt a running command.');
      } else {
        addTerminalOutput('');
        addTerminalOutput('Real command execution available in the desktop build (Tauri).');
      }
      addTerminalOutput('');
      return;
    }

    if (lower === 'pwd') {
      addTerminalOutput(projectPath || `/home/user/${projectName}`);
      return;
    }

    // Real execution in Tauri
    if (isTauri()) {
      setRunning(true);
      try {
        const kill = await spawnCommand(
          cmd,
          cwd,
          (line) => addTerminalOutput(line),
          (line) => addTerminalOutput(`! ${line}`),
          (code) => {
            if (code !== null && code !== 0) {
              addTerminalOutput(`Process exited with code ${code}`);
            }
            setRunning(false);
            killRef.current = null;
          },
        );
        killRef.current = kill;
      } catch (err) {
        addTerminalOutput(`! Error: ${err}`);
        setRunning(false);
      }
      return;
    }

    // Browser fallback
    if (lower === 'ls' || lower === 'ls -la') {
      const files = useWorkbenchStore.getState().files;
      for (const f of files) {
        addTerminalOutput(f.type === 'folder' ? `${f.name}/` : f.name);
      }
      return;
    }

    if (lower.startsWith('echo ')) {
      addTerminalOutput(cmd.slice(5));
      return;
    }

    addTerminalOutput(`Command not available in browser: ${cmd}`);
    addTerminalOutput('Real execution requires the desktop build (Tauri).');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      if (running && killRef.current) {
        killRef.current();
        killRef.current = null;
        setRunning(false);
        addTerminalOutput('^C');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIndex);
          setInput(history[newIndex]);
        }
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clearTerminal();
    }
  };

  return (
    <div
      className="h-full bg-surface-panel border-t border-border flex flex-col"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Terminal</span>
          {isTauri() && (
            <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded">{shellName}</span>
          )}
          {running && (
            <span className="text-[10px] text-warning animate-pulse">running…</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); addTerminalTab(); }}
            title="New terminal"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); clearTerminal(); }}
            title="Clear terminal (Ctrl+L)"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Main area: terminal output + right sidebar */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Terminal content — output scrollable on top, input sticky at bottom */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Scrollable output — inner min-h-full + justify-end pins short output to bottom */}
          <div className="flex-1 overflow-y-auto min-h-0 px-3 pt-1.5 pb-1 font-mono text-[12px] leading-[18px] text-foreground">
            <div className="min-h-full flex flex-col justify-end">
              {terminalOutput.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('\u2713') ? 'text-success' :
                    line.startsWith('!') ? 'text-destructive' :
                    line.startsWith('$') ? 'text-primary font-semibold' :
                    line.startsWith('\u2500\u2500\u2500') ? 'text-muted-foreground border-b border-border/30 pb-1 mb-1' :
                    'text-foreground/90'
                  }
                >
                  {line || '\u00A0'}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Sticky input bar at bottom — always visible */}
          <div className="shrink-0 px-3 py-1.5 border-t border-border bg-surface-panel/95 backdrop-blur-sm">
            <div className="flex items-center gap-2 font-mono text-[12px]">
              <span className="text-primary shrink-0 font-semibold">
                {projectPath ? projectPath.split('/').pop() : projectName}
              </span>
              <span className="text-success shrink-0 font-bold">$</span>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={running ? 'Command running… (Ctrl+C to interrupt)' : 'Type a command…'}
                disabled={running}
                className="flex-1 bg-transparent text-foreground focus:outline-none placeholder:text-muted-foreground/40 disabled:opacity-50 caret-primary"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Right sidebar — terminal instances list (Cursor-style) */}
        {terminalTabs.length > 0 && (
          <div className="w-36 border-l border-border bg-secondary/30 overflow-y-auto shrink-0">
            {terminalTabs.map(tab => (
              <button
                key={tab.id}
                onClick={(e) => { e.stopPropagation(); setActiveTerminal(tab.id); }}
                className={`group w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] transition-colors ${
                  tab.id === activeTerminalId
                    ? 'bg-primary/10 text-foreground border-l-2 border-l-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover border-l-2 border-l-transparent'
                }`}
              >
                <Terminal className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1 text-left">{tab.name}</span>
                {terminalTabs.length > 1 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); removeTerminalTab(tab.id); }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-all shrink-0"
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalPanel;
