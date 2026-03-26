import { Cpu, ChevronDown, Terminal, Settings, Zap, Brain, Code, TestTube } from 'lucide-react';
import { useWorkbenchStore, AppMode } from '@/store/workbenchStore';
import { useModelStore } from '@/store/modelStore';

const modes: { key: AppMode; label: string }[] = [
  { key: 'ask', label: 'Ask' },
  { key: 'plan', label: 'Plan' },
  { key: 'build', label: 'Build' },
];

const TopBar = () => {
  const { mode, setMode, toggleTerminal, terminalVisible } = useWorkbenchStore();
  const { models, setSettingsOpen } = useModelStore();
  const getModelForRole = useModelStore(s => s.getModelForRole);

  const orchestrator = getModelForRole('orchestrator');
  const coder = getModelForRole('coder');
  const tester = getModelForRole('tester');
  const activeCount = models.filter(m => m.enabled).length;

  return (
    <div className="h-11 bg-surface-panel border-b border-border flex items-center justify-between px-4">
      {/* Left */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Zap className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm text-foreground tracking-tight">CodeForge</span>
          <span className="text-xs text-primary font-medium">AI</span>
        </div>
      </div>

      {/* Center — Mode toggle */}
      <div className="flex items-center bg-secondary rounded-lg p-0.5">
        {modes.map(m => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`px-4 py-1 text-xs font-medium rounded-md transition-all ${
              mode === m.key
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* Active agents indicator */}
        <div className="hidden md:flex items-center gap-1.5 bg-secondary px-2.5 py-1 rounded-lg">
          {orchestrator && (
            <div className="flex items-center gap-1" title={`Orchestrator: ${orchestrator.name}`}>
              <Brain className="h-3 w-3 text-accent" />
              <span className="text-[10px] text-accent-foreground/70 max-w-16 truncate">{orchestrator.modelId}</span>
            </div>
          )}
          {coder && (
            <div className="flex items-center gap-1" title={`Coder: ${coder.name}`}>
              <Code className="h-3 w-3 text-primary" />
              <span className="text-[10px] text-foreground/70 max-w-16 truncate">{coder.modelId}</span>
            </div>
          )}
          {tester && (
            <div className="flex items-center gap-1" title={`Tester: ${tester.name}`}>
              <TestTube className="h-3 w-3 text-warning" />
              <span className="text-[10px] text-foreground/70 max-w-16 truncate">{tester.modelId}</span>
            </div>
          )}
        </div>

        {/* Model count badge (mobile) */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="md:hidden flex items-center gap-1 bg-secondary px-2.5 py-1.5 rounded-lg text-xs text-secondary-foreground"
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>{activeCount}</span>
        </button>

        <button
          onClick={toggleTerminal}
          className={`p-1.5 rounded-lg transition-colors ${terminalVisible ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'}`}
        >
          <Terminal className="h-4 w-4" />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TopBar;
