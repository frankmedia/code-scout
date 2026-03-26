import { useState } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useWorkbenchStore, Plan } from '@/store/workbenchStore';
import PlanView from './PlanView';
import LogsView from './LogsView';

const MOCK_PLANS: Record<string, () => Plan> = {
  default: () => ({
    id: crypto.randomUUID(),
    summary: 'Build the requested feature',
    steps: [
      { id: '1', action: 'create_file', path: 'src/pages/Login.tsx', description: 'Create Login page component with form', status: 'pending' },
      { id: '2', action: 'edit_file', path: 'src/App.tsx', description: 'Add login route to router', status: 'pending', diff: { before: `<Route path="/" element={<Home />} />`, after: `<Route path="/" element={<Home />} />\n      <Route path="/login" element={<Login />} />` } },
      { id: '3', action: 'create_file', path: 'src/components/InputField.tsx', description: 'Create reusable input component', status: 'pending' },
      { id: '4', action: 'run_command', command: 'npm install react-hook-form', description: 'Install form library', status: 'pending' },
    ],
    status: 'pending',
  }),
};

const AIPanel = () => {
  const { aiPanel, setAIPanel, messages, addMessage, setCurrentPlan, addLog, mode } = useWorkbenchStore();
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || isThinking) return;
    const userMsg = input.trim();
    setInput('');
    addMessage({ role: 'user', content: userMsg });
    setIsThinking(true);

    // Simulate AI response
    await new Promise(r => setTimeout(r, 1500));

    if (mode === 'plan' || mode === 'build') {
      const plan = MOCK_PLANS.default();
      plan.summary = `Plan for: "${userMsg}"`;
      setCurrentPlan(plan);
      addMessage({
        role: 'assistant',
        content: `I've analyzed your request and created a **${plan.steps.length}-step plan**. Switch to the **Plan** tab to review and approve it before I make any changes.\n\n> No files will be modified until you approve.`,
      });
      addLog(`Plan generated: ${plan.steps.length} steps`, 'info');
      setAIPanel('plan');
    } else {
      addMessage({
        role: 'assistant',
        content: `Great question! Here's what I'd suggest:\n\n1. Create the component structure\n2. Add proper TypeScript types\n3. Connect to your existing routing\n\nSwitch to **Plan mode** to have me generate an executable plan with file changes and diffs.`,
      });
    }
    setIsThinking(false);
  };

  const tabs = [
    { key: 'chat' as const, label: 'Chat' },
    { key: 'plan' as const, label: 'Plan' },
    { key: 'logs' as const, label: 'Logs' },
  ];

  return (
    <div className="h-full flex flex-col bg-surface-panel border-l border-border">
      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setAIPanel(tab.key)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              aiPanel === tab.key
                ? 'text-primary border-b-2 border-primary bg-surface-editor'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {aiPanel === 'chat' && (
          <>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.map(msg => (
                <div key={msg.id} className={`flex gap-2 animate-slide-in ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary/15 text-foreground'
                      : 'bg-card text-card-foreground'
                  }`}>
                    <ReactMarkdown className="prose prose-sm prose-invert max-w-none [&>p]:m-0 [&>p+p]:mt-2 [&>ul]:mt-1 [&>ol]:mt-1 [&>blockquote]:border-primary/50 [&>blockquote]:text-muted-foreground">
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-6 h-6 rounded bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-3.5 w-3.5 text-accent" />
                    </div>
                  )}
                </div>
              ))}
              {isThinking && (
                <div className="flex gap-2 animate-slide-in">
                  <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center shrink-0">
                    <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                  </div>
                  <div className="bg-card rounded-lg px-3 py-2 text-sm text-muted-foreground">
                    Thinking...
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-3 border-t border-border">
              <div className="flex gap-2 items-end">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder={mode === 'plan' ? 'Describe what to build...' : 'Ask a question...'}
                  className="flex-1 bg-input text-foreground text-sm rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground font-sans"
                  rows={2}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isThinking}
                  className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-40 transition-colors"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
        {aiPanel === 'plan' && <PlanView />}
        {aiPanel === 'logs' && <LogsView />}
      </div>
    </div>
  );
};

export default AIPanel;
