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
  const { activeFile, files, updateFileContent } = useWorkbenchStore();

  const activeNode = activeFile ? findFile(files, activeFile) : null;

  return (
    <div className="h-full flex flex-col bg-surface-editor">
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
