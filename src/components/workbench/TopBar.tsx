import { Cpu, ChevronDown, Terminal, Settings, Zap } from 'lucide-react';
import { useWorkbenchStore, AppMode } from '@/store/workbenchStore';

const models = [
  { id: 'local-ollama', label: 'Local (Ollama)', icon: '🟢' },
  { id: 'openai-gpt4', label: 'GPT-4o', icon: '🔵' },
  { id: 'anthropic-claude', label: 'Claude 3.5', icon: '🟠' },
];

const modes: { key: AppMode; label: string }[] = [
  { key: 'ask', label: 'Ask' },
  { key: 'plan', label: 'Plan' },
  { key: 'build', label: 'Build' },
];

const TopBar = () => {
  const { selectedModel, setSelectedModel, mode, setMode, toggleTerminal, terminalVisible } = useWorkbenchStore();
  const currentModel = models.find(m => m.id === selectedModel) || models[0];

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
        {/* Model selector */}
        <div className="relative group">
          <button className="flex items-center gap-1.5 bg-secondary px-3 py-1.5 rounded-lg text-xs text-secondary-foreground hover:bg-surface-hover transition-colors">
            <Cpu className="h-3.5 w-3.5" />
            <span>{currentModel.icon} {currentModel.label}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-xl py-1 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
            {models.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m.id)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors ${
                  m.id === selectedModel ? 'text-primary' : 'text-card-foreground'
                }`}
              >
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={toggleTerminal}
          className={`p-1.5 rounded-lg transition-colors ${terminalVisible ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'}`}
        >
          <Terminal className="h-4 w-4" />
        </button>
        <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TopBar;
