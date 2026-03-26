import { useWorkbenchStore } from '@/store/workbenchStore';

const typeColors = {
  info: 'text-info',
  success: 'text-success',
  error: 'text-destructive',
  warning: 'text-warning',
};

const LogsView = () => {
  const { logs } = useWorkbenchStore();

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
      {logs.map((log, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-muted-foreground shrink-0">{log.time}</span>
          <span className={typeColors[log.type]}>{log.message}</span>
        </div>
      ))}
      {logs.length === 0 && <p className="text-muted-foreground">No logs yet.</p>}
    </div>
  );
};

export default LogsView;
