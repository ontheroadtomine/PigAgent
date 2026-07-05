import React from 'react';
import { useAppStore } from '../../stores/app-store';

function basename(inputPath: string): string {
  return inputPath.split(/[\\/]/).filter(Boolean).pop() || inputPath;
}

export default function WorkspaceSidebar() {
  const {
    workspaces,
    conversations,
    activeWorkspaceId,
    activeConversationId,
    expandedWorkspaces,
    loading,
    addWorkspace,
    selectWorkspace,
    toggleWorkspace,
    createConversation,
    renameConversation,
    selectConversation,
  } = useAppStore();

  const handleAddWorkspace = async () => {
    if (loading) return;
    let dirPath: string | null = null;
    if (window.pigagent?.selectDirectory) {
      dirPath = await window.pigagent.selectDirectory();
    } else {
      window.alert('当前浏览器预览无法打开系统目录选择器，请在 Electron 桌面应用中添加工作区。');
      return;
    }
    if (!dirPath?.trim()) return;
    const trimmedPath = dirPath.trim();
    await addWorkspace(basename(trimmedPath), trimmedPath);
  };

  const handleNewChat = async (workspaceId: string, workspaceName: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (loading) return;
    await createConversation(workspaceId, workspaceName);
  };

  const handleRenameConversation = async (conversationId: string, currentTitle: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (loading) return;
    const nextTitle = window.prompt('重命名对话', currentTitle);
    if (!nextTitle?.trim() || nextTitle.trim() === currentTitle) return;
    await renameConversation(conversationId, nextTitle.trim());
  };

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]/70">
      <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Workspaces</div>
        <button
          onClick={handleAddWorkspace}
          disabled={loading}
          className="grid h-7 w-7 place-items-center rounded-md text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          title="添加工作区"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
        {workspaces.map(workspace => {
          const expanded = expandedWorkspaces.has(workspace.id);
          const active = activeWorkspaceId === workspace.id;
          const workspaceConversations = conversations.filter(conversation => conversation.workspaceId === workspace.id);
          return (
            <div key={workspace.id} className="mb-1">
              <div className={`flex items-center rounded-md transition ${active ? 'bg-[var(--muted)] text-[var(--foreground)]' : 'text-[var(--foreground)]/70 hover:bg-[var(--muted)]/70'}`}>
                <button
                  onClick={async () => {
                    if (loading) return;
                    toggleWorkspace(workspace.id);
                    if (!active) await selectWorkspace(workspace.id);
                  }}
                  disabled={loading}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  title={workspace.path}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                    className="shrink-0 transition-transform"
                    style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  ><polyline points="9 18 15 12 9 6"/></svg>
                  <span className="min-w-0 flex-1 truncate font-medium">{workspace.name}</span>
                </button>
                <button
                  onClick={(event) => handleNewChat(workspace.id, workspace.name, event)}
                  disabled={loading}
                  className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--muted-foreground)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="新建对话"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                </button>
              </div>

              {expanded && (
                <div className="ml-5 mt-1 space-y-0.5">
                  {workspaceConversations.length === 0 && (
                    <div className="px-2 py-1 text-[11px] text-[var(--muted-foreground)]">暂无对话</div>
                  )}
                  {workspaceConversations.map(conversation => (
                    <div
                      key={conversation.id}
                      className={`group flex w-full items-center rounded-md text-xs transition ${activeConversationId === conversation.id ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm' : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)]/70 hover:text-[var(--foreground)]/80'}`}
                    >
                      <button
                        onClick={async () => {
                          if (loading) return;
                          if (activeWorkspaceId !== workspace.id) await selectWorkspace(workspace.id);
                          selectConversation(conversation);
                        }}
                        disabled={loading}
                        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        title={conversation.title}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
                        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                      </button>
                      <button
                        onClick={(event) => handleRenameConversation(conversation.id, conversation.title, event)}
                        disabled={loading}
                        className="mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--muted-foreground)] opacity-0 transition hover:bg-[var(--background)] hover:text-[var(--foreground)] group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                        title="重命名对话"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
