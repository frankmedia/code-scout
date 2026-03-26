import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen } from 'lucide-react';
import { FileNode, useWorkbenchStore } from '@/store/workbenchStore';

const FileIcon = ({ name }: { name: string }) => {
  const ext = name.split('.').pop();
  const colors: Record<string, string> = {
    tsx: 'text-info', ts: 'text-info', jsx: 'text-warning', js: 'text-warning',
    css: 'text-accent', json: 'text-success', md: 'text-muted-foreground',
  };
  return <FileText className={`h-4 w-4 shrink-0 ${colors[ext || ''] || 'text-muted-foreground'}`} />;
};

const TreeNode = ({ node, depth = 0 }: { node: FileNode; depth?: number }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const { activeFile, openFile } = useWorkbenchStore();
  const isActive = activeFile === node.path;

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 px-2 py-1 text-sm hover:bg-surface-hover rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          {expanded ? <FolderOpen className="h-4 w-4 text-primary shrink-0" /> : <Folder className="h-4 w-4 text-primary shrink-0" />}
          <span className="text-sidebar-foreground truncate">{node.name}</span>
        </button>
        {expanded && node.children?.map(child => (
          <TreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => openFile(node.path)}
      className={`flex w-full items-center gap-1.5 px-2 py-1 text-sm rounded transition-colors ${
        isActive ? 'bg-surface-active text-foreground' : 'hover:bg-surface-hover text-sidebar-foreground'
      }`}
      style={{ paddingLeft: `${depth * 12 + 24}px` }}
    >
      <FileIcon name={node.name} />
      <span className="truncate">{node.name}</span>
    </button>
  );
};

const FileTree = () => {
  const { files, projectName } = useWorkbenchStore();

  return (
    <div className="h-full flex flex-col bg-sidebar overflow-hidden">
      <div className="px-3 py-2.5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{projectName}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {files.map(node => <TreeNode key={node.path} node={node} />)}
      </div>
    </div>
  );
};

export default FileTree;
