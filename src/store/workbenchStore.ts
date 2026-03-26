import { create } from 'zustand';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  content?: string;
  language?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface PlanStep {
  id: string;
  action: 'create_file' | 'edit_file' | 'delete_file' | 'run_command';
  path?: string;
  command?: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'error';
  diff?: { before: string; after: string };
}

export interface Plan {
  id: string;
  summary: string;
  steps: PlanStep[];
  status: 'pending' | 'approved' | 'executing' | 'done' | 'rejected';
}

export type AppMode = 'ask' | 'plan' | 'build';
export type AIPanel = 'chat' | 'plan' | 'logs';

interface WorkbenchState {
  // Project
  projectName: string;
  files: FileNode[];

  // Editor
  openFiles: string[];
  activeFile: string | null;
  unsavedFiles: Set<string>;

  // AI
  mode: AppMode;
  aiPanel: AIPanel;
  messages: ChatMessage[];
  currentPlan: Plan | null;
  selectedModel: string;

  // Terminal
  terminalOutput: string[];
  terminalVisible: boolean;

  // Logs
  logs: { time: string; message: string; type: 'info' | 'success' | 'error' | 'warning' }[];

  // Actions
  setActiveFile: (path: string) => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setMode: (mode: AppMode) => void;
  setAIPanel: (panel: AIPanel) => void;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setCurrentPlan: (plan: Plan | null) => void;
  updatePlanStatus: (status: Plan['status']) => void;
  updateStepStatus: (stepId: string, status: PlanStep['status']) => void;
  setSelectedModel: (model: string) => void;
  addTerminalOutput: (line: string) => void;
  toggleTerminal: () => void;
  addLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  updateFileContent: (path: string, content: string) => void;
}

const MOCK_FILES: FileNode[] = [
  {
    name: 'src', path: 'src', type: 'folder', children: [
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file', language: 'typescript', content: `import React from 'react';\nimport { BrowserRouter, Route, Routes } from 'react-router-dom';\nimport Home from './pages/Home';\n\nconst App = () => (\n  <BrowserRouter>\n    <Routes>\n      <Route path="/" element={<Home />} />\n    </Routes>\n  </BrowserRouter>\n);\n\nexport default App;` },
      { name: 'main.tsx', path: 'src/main.tsx', type: 'file', language: 'typescript', content: `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);` },
      { name: 'index.css', path: 'src/index.css', type: 'file', language: 'css', content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody {\n  margin: 0;\n  font-family: sans-serif;\n}` },
      {
        name: 'pages', path: 'src/pages', type: 'folder', children: [
          { name: 'Home.tsx', path: 'src/pages/Home.tsx', type: 'file', language: 'typescript', content: `const Home = () => {\n  return (\n    <div className="p-8">\n      <h1 className="text-3xl font-bold">Welcome</h1>\n      <p className="mt-4 text-gray-600">Your app starts here.</p>\n    </div>\n  );\n};\n\nexport default Home;` },
        ]
      },
      {
        name: 'components', path: 'src/components', type: 'folder', children: [
          { name: 'Button.tsx', path: 'src/components/Button.tsx', type: 'file', language: 'typescript', content: `interface ButtonProps {\n  children: React.ReactNode;\n  onClick?: () => void;\n  variant?: 'primary' | 'secondary';\n}\n\nconst Button = ({ children, onClick, variant = 'primary' }: ButtonProps) => (\n  <button\n    onClick={onClick}\n    className={\`px-4 py-2 rounded \${\n      variant === 'primary' ? 'bg-blue-500 text-white' : 'bg-gray-200'\n    }\`}\n  >\n    {children}\n  </button>\n);\n\nexport default Button;` },
        ]
      },
    ]
  },
  { name: 'package.json', path: 'package.json', type: 'file', language: 'json', content: `{\n  "name": "my-app",\n  "version": "1.0.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}` },
  { name: 'tsconfig.json', path: 'tsconfig.json', type: 'file', language: 'json', content: `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "jsx": "react-jsx",\n    "strict": true\n  }\n}` },
  { name: 'README.md', path: 'README.md', type: 'file', language: 'markdown', content: `# My App\n\nA React application.\n\n## Getting Started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`` },
];

function findFile(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findFile(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  projectName: 'my-app',
  files: MOCK_FILES,
  openFiles: ['src/App.tsx'],
  activeFile: 'src/App.tsx',
  unsavedFiles: new Set(),
  mode: 'plan',
  aiPanel: 'chat',
  messages: [
    { id: '1', role: 'assistant', content: "Welcome to **CodeForge AI**. I'm your coding agent. Describe what you want to build, and I'll create a plan for you to review before making any changes.\n\nTry: *\"Build a login page with email and password\"*", timestamp: Date.now() }
  ],
  currentPlan: null,
  selectedModel: 'local-ollama',
  terminalOutput: ['$ Ready.'],
  terminalVisible: false,
  logs: [{ time: new Date().toLocaleTimeString(), message: 'Workbench initialized', type: 'info' }],

  setActiveFile: (path) => set({ activeFile: path }),
  openFile: (path) => {
    const { openFiles } = get();
    if (!openFiles.includes(path)) {
      set({ openFiles: [...openFiles, path], activeFile: path });
    } else {
      set({ activeFile: path });
    }
  },
  closeFile: (path) => {
    const { openFiles, activeFile } = get();
    const next = openFiles.filter(f => f !== path);
    set({
      openFiles: next,
      activeFile: activeFile === path ? (next[next.length - 1] || null) : activeFile,
    });
  },
  setMode: (mode) => set({ mode }),
  setAIPanel: (panel) => set({ aiPanel: panel }),
  addMessage: (msg) => set(s => ({
    messages: [...s.messages, { ...msg, id: crypto.randomUUID(), timestamp: Date.now() }]
  })),
  setCurrentPlan: (plan) => set({ currentPlan: plan }),
  updatePlanStatus: (status) => set(s => ({
    currentPlan: s.currentPlan ? { ...s.currentPlan, status } : null
  })),
  updateStepStatus: (stepId, status) => set(s => ({
    currentPlan: s.currentPlan ? {
      ...s.currentPlan,
      steps: s.currentPlan.steps.map(step =>
        step.id === stepId ? { ...step, status } : step
      )
    } : null
  })),
  setSelectedModel: (model) => set({ selectedModel: model }),
  addTerminalOutput: (line) => set(s => ({ terminalOutput: [...s.terminalOutput, line] })),
  toggleTerminal: () => set(s => ({ terminalVisible: !s.terminalVisible })),
  addLog: (message, type = 'info') => set(s => ({
    logs: [...s.logs, { time: new Date().toLocaleTimeString(), message, type }]
  })),
  updateFileContent: (path, content) => set(s => {
    const updateContent = (nodes: FileNode[]): FileNode[] =>
      nodes.map(n => {
        if (n.path === path) return { ...n, content };
        if (n.children) return { ...n, children: updateContent(n.children) };
        return n;
      });
    return { files: updateContent(s.files) };
  }),
}));

export { findFile };
