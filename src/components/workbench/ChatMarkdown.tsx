import React, { useCallback, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Copy, Loader2, Play } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import { isTauri, executeCommand } from '@/lib/tauri';
import { normalizeShellSnippet } from '@/utils/shellSnippet';

const SHELL_LANG_RE = /language-(bash|sh|shell|zsh|console|terminal)\b/i;

function parseShellBlock(children: React.ReactNode): { className: string; code: string } | null {
  const flat = React.Children.toArray(children).filter(Boolean);
  if (flat.length !== 1 || !React.isValidElement(flat[0])) return null;
  const el = flat[0];
  if (typeof el.type !== 'string' || el.type !== 'code') return null;
  const props = el.props as { className?: string; children?: React.ReactNode };
  const cn = props.className || '';
  if (!SHELL_LANG_RE.test(cn)) return null;
  const code = String(React.Children.toArray(props.children).join('')).replace(/\n$/, '');
  return { className: cn, code };
}

function ShellCodeBlock({ code, languageClass }: { code: string; languageClass: string }) {
  const projectPath = useWorkbenchStore(s => s.projectPath);
  const projectName = useWorkbenchStore(s => s.projectName);
  const addTerminalOutput = useWorkbenchStore(s => s.addTerminalOutput);
  const addLog = useWorkbenchStore(s => s.addLog);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const normalized = normalizeShellSnippet(code);
  const tauri = isTauri();
  const canRun = tauri && !!projectPath && normalized.length > 0;
  const runHint = !tauri
    ? 'Run is available in the desktop app'
    : !projectPath
      ? 'Open a project folder first'
      : !normalized
        ? 'Nothing to run after removing comments / empty lines'
        : 'Run this snippet in the project folder';

  const copyRaw = useCallback(() => {
    void navigator.clipboard.writeText(code).then(
      () => addLog('Copied command block to clipboard', 'success'),
      () => addLog('Could not copy to clipboard', 'error'),
    );
  }, [code, addLog]);

  const runConfirmed = useCallback(async () => {
    setConfirmOpen(false);
    if (!canRun) return;
    setRunning(true);
    addTerminalOutput(`$ ${normalized.split('\n').join('\n$ ')}`);
    try {
      const result = await executeCommand(normalized, projectPath!);
      if (result.stdout) {
        result.stdout.split('\n').forEach(line => {
          if (line.length) addTerminalOutput(line);
        });
      }
      if (result.stderr) {
        result.stderr.split('\n').forEach(line => {
          if (line.length) addTerminalOutput(`! ${line}`);
        });
      }
      if (result.code !== null && result.code !== 0) {
        addTerminalOutput(`Process exited with code ${result.code}`);
        addLog(`Chat Run exited ${result.code}`, 'warning');
        // Record failure to agent memory so future plans avoid repeating it
        const stderrSnippet = result.stderr?.slice(-400) || '';
        const stdoutSnippet = result.stdout?.slice(-200) || '';
        const failContext = [stderrSnippet, stdoutSnippet].filter(Boolean).join(' | ');
        if (result.code === 127) {
          const missingBin = normalized.trim().match(/^(\S+)/)?.[1] ?? normalized.trim().slice(0, 40);
          useAgentMemoryStore.getState().addMemory({
            projectName,
            category: 'error',
            title: `Chat Run: missing binary "${missingBin}" (exit 127)`,
            content: `Chat Run command "${normalized.slice(0, 120)}" failed — binary "${missingBin}" not found. ${failContext}. Use "npx ${missingBin}" or install it first.`,
            tags: ['chat_run', 'missing_binary', missingBin, 'exit_127'],
            outcome: 'failure',
          });
        } else if (failContext) {
          useAgentMemoryStore.getState().addMemory({
            projectName,
            category: 'error',
            title: `Chat Run failed (exit ${result.code}): ${normalized.slice(0, 60)}`,
            content: `Chat Run command "${normalized.slice(0, 120)}" exited ${result.code}. Error: ${failContext.slice(0, 400)}`,
            tags: ['chat_run', `exit_${result.code}`],
            outcome: 'failure',
          });
        }
      } else {
        addLog('Chat: shell snippet finished', 'success');
        // Record successful command to memory so agents can reuse it
        useAgentMemoryStore.getState().addMemory({
          projectName,
          category: 'build_outcome',
          title: `Chat Run succeeded: ${normalized.slice(0, 60)}`,
          content: `Command ran successfully: "${normalized.slice(0, 200)}"`,
          tags: ['chat_run', 'success'],
          outcome: 'success',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addTerminalOutput(`! ${msg}`);
      addLog(`Chat Run failed: ${msg}`, 'error');
    } finally {
      setRunning(false);
    }
  }, [canRun, normalized, projectPath, projectName, addTerminalOutput, addLog]);

  return (
    <>
      <div className="relative rounded-md border border-border overflow-hidden my-2 not-prose">
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-secondary/80 border-b border-border">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono truncate" title={languageClass}>
            shell
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={copyRaw}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
              title="Copy block"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
            <button
              type="button"
              disabled={!canRun || running}
              title={runHint}
              onClick={() => canRun && setConfirmOpen(true)}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run
            </button>
          </div>
        </div>
        <pre className="m-0 overflow-x-auto bg-muted/30 px-3.5 py-2.5 text-xs font-mono leading-relaxed">
          <code className={languageClass}>{code}</code>
        </pre>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Run shell snippet?</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Confirm execution of a shell command in the opened project directory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2 text-left text-sm text-muted-foreground px-1 -mt-1">
            <p>
              Runs in your project folder via{' '}
              <code className="text-xs bg-muted px-1 rounded text-foreground">sh -c</code>{' '}
              (same as the Terminal panel).
            </p>
            <pre className="text-xs font-mono text-foreground bg-muted/50 border border-border rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
              {normalized}
            </pre>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runConfirmed()}>Run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PreWithShell({ children }: { children?: React.ReactNode }) {
  const shell = parseShellBlock(children);
  if (shell) {
    return <ShellCodeBlock code={shell.code} languageClass={shell.className} />;
  }
  return (
    <pre className="overflow-x-auto rounded-md bg-muted/40 border border-border px-4 py-3 text-xs my-2 font-mono whitespace-pre-wrap not-prose">
      {children}
    </pre>
  );
}

const markdownComponents: Partial<Components> = {
  pre: PreWithShell,
};

export function ChatMarkdown({ content }: { content: string }) {
  return <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>;
}
