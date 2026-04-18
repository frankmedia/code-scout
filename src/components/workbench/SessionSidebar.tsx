import { useState, useCallback } from 'react';
import { Plus, MessageSquare, Trash2, Edit2, Check, X, ChevronLeft, LogOut, Settings } from 'lucide-react';
import { useChatHistoryStore, createWelcomeMessages, type SavedChat } from '@/store/chatHistoryStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { useProjectStore } from '@/store/projectStore';
import { useAuthStore } from '@/store/authStore';
import { useModelStore } from '@/store/modelStore';

/** Stable fallback for Zustand selectors — a fresh [] each time breaks useSyncExternalStore. */
const EMPTY_SAVED_CHATS: SavedChat[] = [];

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SessionSidebar = () => {
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const savedChats = useChatHistoryStore(
    useCallback(
      s =>
        activeProjectId
          ? (s.chatsByProject[activeProjectId] ?? EMPTY_SAVED_CHATS)
          : EMPTY_SAVED_CHATS,
      [activeProjectId],
    ),
  );
  const activeChatId = useChatHistoryStore(
    useCallback(
      s =>
        activeProjectId
          ? (s.activeChatByProject[activeProjectId] ?? null)
          : null,
      [activeProjectId],
    ),
  );
  const { deleteChat, renameChat, loadChat, setActiveChatId } = useChatHistoryStore();
  const { setMessages, bumpChatSession, setCurrentPlan } = useWorkbenchStore();
  const { closeProject, getActiveProject } = useProjectStore();
  const activeProject = getActiveProject();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const sorted = [...savedChats].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleNewChat = () => {
    const currentMessages = useWorkbenchStore.getState().messages;
    const userMsgs = currentMessages.filter(m => m.role === 'user');
    if (userMsgs.length > 0) {
      useChatHistoryStore.getState().saveCurrentChat(currentMessages);
    }
    setMessages(createWelcomeMessages());
    setCurrentPlan(null);
    setActiveChatId(null);
    bumpChatSession();
  };

  const handleLoadChat = (id: string) => {
    const chat = loadChat(id);
    if (!chat) return;
    setMessages(chat.messages);
    setCurrentPlan(null);
    setActiveChatId(id);
    bumpChatSession();
  };

  const handleRenameStart = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(title);
  };

  const handleRenameConfirm = (id: string) => {
    if (editTitle.trim()) {
      renameChat(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleRenameCancel = () => {
    setEditingId(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteChat(id);
    if (activeChatId === id) {
      setActiveChatId(null);
      setMessages(createWelcomeMessages());
      setCurrentPlan(null);
      bumpChatSession();
    }
  };

  return (
    <div className="h-full flex flex-col bg-secondary/30 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[12px] font-semibold text-foreground truncate" title={activeProject?.name}>
            {activeProject?.name || 'Sessions'}
          </p>
          <button
            onClick={closeProject}
            title="Back to projects"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={handleNewChat}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary hover:bg-primary/15 transition-colors font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <div className="p-4 text-center">
            <MessageSquare className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No sessions yet</p>
          </div>
        ) : (
          sorted.map(chat => {
            const isActive = chat.id === activeChatId;
            return (
              <div
                key={chat.id}
                onClick={() => handleLoadChat(chat.id)}
                className={`group relative flex flex-col px-3 py-2.5 cursor-pointer transition-colors rounded-lg mx-1.5 mb-0.5 ${
                  isActive
                    ? 'bg-primary/10'
                    : 'hover:bg-muted/50'
                }`}
              >
                {editingId === chat.id ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRenameConfirm(chat.id);
                        if (e.key === 'Escape') handleRenameCancel();
                      }}
                      onBlur={() => handleRenameConfirm(chat.id)}
                      className="flex-1 bg-input text-xs text-foreground rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                    <button
                      onClick={() => handleRenameConfirm(chat.id)}
                      className="p-0.5 rounded text-success hover:bg-success/10"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={handleRenameCancel}
                      className="p-0.5 rounded text-muted-foreground hover:bg-surface-hover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-xs text-foreground truncate pr-10 leading-tight">
                      {chat.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">
                      {timeAgo(chat.updatedAt)}
                    </span>

                    {/* Hover actions */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => handleRenameStart(e, chat.id, chat.title)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-active"
                        title="Rename"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={e => handleDelete(e, chat.id)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* User profile + logout — pinned to bottom */}
      <UserFooter />
    </div>
  );
};

const UserFooter = () => {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const setSettingsOpen = useModelStore(s => s.setSettingsOpen);

  if (!user) return null;

  const initials = user.email
    .split('@')[0]
    .split(/[._-]/)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="shrink-0 border-t border-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-primary">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-foreground truncate">{user.email.split('@')[0]}</p>
          <p className="text-[9px] text-muted-foreground truncate">{user.accountType || 'Free'}</p>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={logout}
          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Log out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default SessionSidebar;
