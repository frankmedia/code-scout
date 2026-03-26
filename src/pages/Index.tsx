import { useWorkbenchStore } from '@/store/workbenchStore';
import TopBar from '@/components/workbench/TopBar';
import FileTree from '@/components/workbench/FileTree';
import EditorPanel from '@/components/workbench/EditorPanel';
import AIPanel from '@/components/workbench/AIPanel';
import TerminalPanel from '@/components/workbench/TerminalPanel';
import ModelSettings from '@/components/workbench/ModelSettings';

const Index = () => {
  const { terminalVisible } = useWorkbenchStore();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        {/* File tree */}
        <div className="w-56 shrink-0 border-r border-border">
          <FileTree />
        </div>

        {/* Editor + Terminal */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <EditorPanel />
          </div>
          {terminalVisible && (
            <div className="h-40 shrink-0">
              <TerminalPanel />
            </div>
          )}
        </div>

        {/* AI Panel */}
        <div className="w-80 shrink-0">
          <AIPanel />
        </div>
      </div>
    </div>
  );
};

export default Index;
