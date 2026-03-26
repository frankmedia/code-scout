import { X } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { useWorkbenchStore, findFile } from '@/store/workbenchStore';

const EditorPanel = () => {
  const { openFiles, activeFile, files, setActiveFile, closeFile, updateFileContent } = useWorkbenchStore();

  const activeNode = activeFile ? findFile(files, activeFile) : null;

  return (
    <div className="h-full flex flex-col bg-surface-editor">
      {/* Tabs */}
      <div className="flex items-center bg-surface-panel border-b border-border overflow-x-auto">
        {openFiles.map(path => {
          const name = path.split('/').pop() || path;
          const isActive = path === activeFile;
          return (
            <div
              key={path}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-r border-border transition-colors group ${
                isActive
                  ? 'bg-surface-editor text-foreground border-t-2 border-t-primary'
                  : 'text-muted-foreground hover:bg-surface-hover border-t-2 border-t-transparent'
              }`}
              onClick={() => setActiveFile(path)}
            >
              <span className="font-mono">{name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeFile(path); }}
                className="opacity-0 group-hover:opacity-100 hover:bg-surface-active rounded p-0.5 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor */}
      <div className="flex-1">
        {activeNode ? (
          <Editor
            theme="vs-dark"
            language={activeNode.language === 'typescript' ? 'typescript' : activeNode.language}
            value={activeNode.content || ''}
            onChange={(value) => {
              if (value !== undefined && activeFile) {
                updateFileContent(activeFile, value);
              }
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              lineHeight: 20,
              padding: { top: 12 },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'line',
              cursorBlinking: 'smooth',
              smoothScrolling: true,
              bracketPairColorization: { enabled: true },
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">No file open</p>
              <p className="text-sm">Select a file from the sidebar to start editing</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditorPanel;
