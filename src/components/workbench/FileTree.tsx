import { useState, useMemo, useCallback } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Undo2, Loader2, RefreshCw, Search } from 'lucide-react';
import { FileNode, useWorkbenchStore } from '@/store/workbenchStore';
import { useProjectMemoryStore } from '@/store/projectMemoryStore';
import { indexProject } from '@/services/memoryManager';

const FileIcon = ({ name }: { name: string }) => {
  const ext = name.split('.').pop();
  const colors: Record<string, string> = {
    tsx: 'text-info', ts: 'text-info', jsx: 'text-warning', js: 'text-warning',
    css: 'text-accent', json: 'text-success', md: 'text-muted-foreground',
  };
  return <FileText className={`h-3 w-3 shrink-0 ${colors[ext || ''] || 'text-muted-foreground'}`} />;
};

type ChangeType = 'created' | 'edited' | null;

/** Keep folders that match or contain matching files; if a folder name/path matches, show full subtree. */
function filterFileTree(nodes: FileNode[], query: string): FileNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  const selfMatch = (n: FileNode) =>
    n.name.toLowerCase().includes(needle) || n.path.toLowerCase().includes(needle);
  const walk = (list: FileNode[]): FileNode[] => {
    const out: FileNode[] = [];
    for (const n of list) {
      if (n.type === 'file') {
        if (selfMatch(n)) out.push(n);
      } else {
        const kids = n.children ?? [];
        const filteredKids = walk(kids);
        if (selfMatch(n)) {
          out.push({ ...n, children: kids });
        } else if (filteredKids.length > 0) {
          out.push({ ...n, children: filteredKids });
        }
      }
    }
    return out;
  };
  return walk(nodes);
}

const TreeNode = ({ node, depth = 0, changedFiles }: { node: FileNode; depth?: number; changedFiles: Map<string, ChangeType> }) => {
  const [expanded, setExpanded] = useState(false);
  const { activeFile, openFile, rollbackFile, addLog } = useWorkbenchStore();
  const isActive = activeFile === node.path;
  const changeType = changedFiles.get(node.path) || null;

  const handleRollback = (e: React.MouseEvent) => {
    e.stopPropagation();
    rollbackFile(node.path);
    addLog(`Rolled back: ${node.path}`, 'warning');
  };

  if (node.type === 'folder') {
    // Check if any children have changes
    const hasChangedChildren = node.children?.some(child => {
      if (changedFiles.has(child.path)) return true;
      if (child.type === 'folder' && child.children) {
        return child.children.some(gc => changedFiles.has(gc.path));
      }
      return false;
    });

    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 px-2 py-0.5 text-xs hover:bg-surface-hover rounded transition-colors"
          style={{ paddingLeft: `${depth * 10 + 6}px` }}
        >
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
          {expanded ? <FolderOpen className="h-3 w-3 text-primary shrink-0" /> : <Folder className="h-3 w-3 text-primary shrink-0" />}
          <span className="text-sidebar-foreground truncate">{node.name}</span>
          {hasChangedChildren && (
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
          )}
        </button>
        {expanded &&
          (node.children && node.children.length > 0 ? (
            node.children.map(child => (
              <TreeNode key={child.path} node={child} depth={depth + 1} changedFiles={changedFiles} />
            ))
          ) : (
            <div
              className="py-0.5 text-[10px] text-muted-foreground/80 italic"
              style={{ paddingLeft: `${(depth + 1) * 10 + 18}px` }}
            >
              Empty folder
            </div>
          ))}
      </div>
    );
  }

  return (
    <div
      className={`group flex w-full items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors cursor-pointer ${
        isActive ? 'bg-surface-active text-foreground' : 'hover:bg-surface-hover text-sidebar-foreground'
      }`}
      style={{ paddingLeft: `${depth * 10 + 18}px` }}
      onClick={() => openFile(node.path)}
    >
      <FileIcon name={node.name} />
      <span className={`truncate flex-1 ${
        changeType === 'created' ? 'text-success font-medium' :
        changeType === 'edited'  ? 'text-primary' : ''
      }`}>{node.name}</span>

      {/* Change badge */}
      {changeType === 'created' && (
        <span className="text-[9px] font-bold px-0.5 rounded bg-success/15 text-success shrink-0" title="New file (created by agent)">N</span>
      )}
      {changeType === 'edited' && (
        <span className="text-[9px] font-bold px-0.5 rounded bg-primary/15 text-primary shrink-0" title="Modified by agent">M</span>
      )}

      {/* Per-file rollback */}
      {changeType && (
        <button
          onClick={handleRollback}
          title="Rollback this file"
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-warning transition-all shrink-0"
        >
          <Undo2 className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
};

const FileTree = () => {
  const { files, projectName, projectPath, fileHistory } = useWorkbenchStore();
  const [pathFilter, setPathFilter] = useState('');

  // Build a map of changed files from history
  const changedFiles = useMemo(() => {
    const map = new Map<string, ChangeType>();
    for (const snapshot of fileHistory) {
      if (snapshot.action === 'created') {
        map.set(snapshot.path, 'created');
      } else if (snapshot.action === 'edited') {
        map.set(snapshot.path, 'edited');
      }
    }
    return map;
  }, [fileHistory]);

  const isIndexing = useProjectMemoryStore(s => s.isIndexing);
  const memory = useProjectMemoryStore(s => s.memories[projectName]);

  const visibleFiles = useMemo(() => filterFileTree(files, pathFilter), [files, pathFilter]);

  const handleReindex = useCallback(() => {
    if (isIndexing || files.length === 0) return;
    useProjectMemoryStore.getState().setIndexing(true);
    // Mark existing memory as stale so it gets fully rebuilt
    useProjectMemoryStore.getState().markStale(projectName);
    queueMicrotask(() => {
      try {
        indexProject(files, projectName, projectPath || undefined);
      } finally {
        useProjectMemoryStore.getState().setIndexing(false);
      }
    });
  }, [files, projectName, projectPath, isIndexing]);

  return (
    <div className="h-full flex flex-col bg-sidebar overflow-hidden">
      <div className="px-3 py-2.5 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate flex-1">{projectName}</span>
          {isIndexing && (
            <span className="flex items-center gap-1 text-[10px] text-primary font-medium shrink-0">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              indexing...
            </span>
          )}
          {!isIndexing && memory && (
            <span className="text-[10px] text-muted-foreground/60 truncate max-w-[80px] shrink-0" title={`${memory.repoMap.primaryLanguage} · ${memory.repoMap.framework}\nClick refresh to re-index`}>
              {memory.repoMap.primaryLanguage}
            </span>
          )}
          {!isIndexing && (
            <button
              onClick={handleReindex}
              className="p-0.5 rounded text-muted-foreground/40 hover:text-primary hover:bg-surface-hover transition-colors shrink-0"
              title="Re-index project"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
          {changedFiles.size > 0 && !isIndexing && (
            <span className="text-[10px] text-primary font-medium shrink-0">
              {changedFiles.size} changed
            </span>
          )}
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={pathFilter}
            onChange={e => setPathFilter(e.target.value)}
            placeholder="Filter files…"
            className="w-full bg-sidebar-accent/40 border border-sidebar-border rounded-md pl-7 pr-2 py-1.5 text-[11px] text-sidebar-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Filter file tree"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {pathFilter.trim() && visibleFiles.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">No files match “{pathFilter.trim()}”.</p>
        ) : (
          visibleFiles.map(node => <TreeNode key={node.path} node={node} changedFiles={changedFiles} />)
        )}
      </div>
    </div>
  );
};

export default FileTree;
