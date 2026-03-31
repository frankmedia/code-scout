import { X, Undo2 } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { useWorkbenchStore, FileNode } from '@/store/workbenchStore';

const findFile = (nodes: FileNode[], path: string): FileNode | null => {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) { const found = findFile(n.children, path); if (found) return found; }
  }
  return null;
};

const EditorPanel = () => {
  const { openFiles, activeFile, files, setActiveFile, closeFile, updateFileContent, fileHistory, rollbackFile, addLog } = useWorkbenchStore();

  const activeNode = activeFile ? findFile(files, activeFile) : null;

  // Build set of changed files
  const changedPaths = new Set(fileHistory.map(s => s.path));

  return (
    <div className="h-full flex flex-col bg-surface-editor">
      {/* Tabs */}
      <div className="flex items-center bg-surface-panel border-b border-border overflow-x-auto">
        {openFiles.map(path => {
          const name = path.split('/').pop() || path;
          const isActive = path === activeFile;
          const isChanged = changedPaths.has(path);
          const changeType = fileHistory.find(s => s.path === path)?.action;

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

              {/* Change badge */}
              {isChanged && changeType === 'created' && (
                <span className="text-[9px] font-bold text-success" title="New file">N</span>
              )}
              {isChanged && changeType === 'edited' && (
                <span className="text-[9px] font-bold text-primary" title="Modified">M</span>
              )}

              {/* Rollback button */}
              {isChanged && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    rollbackFile(path);
                    addLog(`Rolled back: ${path}`, 'warning');
                  }}
                  title="Rollback changes"
                  className="opacity-0 group-hover:opacity-100 hover:bg-warning/20 rounded p-0.5 transition-opacity text-muted-foreground hover:text-warning"
                >
                  <Undo2 className="h-3 w-3" />
                </button>
              )}

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
