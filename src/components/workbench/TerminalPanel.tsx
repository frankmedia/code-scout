import { useWorkbenchStore } from '@/store/workbenchStore';

const TerminalPanel = () => {
  const { terminalOutput } = useWorkbenchStore();

  return (
    <div className="h-full bg-surface-panel border-t border-border flex flex-col">
      <div className="px-3 py-1.5 border-b border-border flex items-center">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Terminal</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-foreground space-y-0.5">
        {terminalOutput.map((line, i) => (
          <div key={i} className={line.startsWith('✓') ? 'text-success' : line.startsWith('!') ? 'text-destructive' : ''}>{line}</div>
        ))}
      </div>
    </div>
  );
};

export default TerminalPanel;
