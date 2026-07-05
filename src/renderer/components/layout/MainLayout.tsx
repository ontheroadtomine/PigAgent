import ChatPanel from '../chat/ChatPanel';
import WorkspaceSidebar from '../workspace/WorkspaceSidebar';

export default function MainLayout() {
  return (
    <div className="h-screen bg-[var(--background)] text-[var(--foreground)] text-sm overflow-hidden">
      <div className="flex h-full min-w-0">
        <WorkspaceSidebar />
        <div className="min-w-0 flex-1">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
