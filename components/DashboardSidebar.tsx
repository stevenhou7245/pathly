"use client";

import UnreadBadge from "@/components/UnreadBadge";
import type { DashboardView, LearningFolder } from "@/components/dashboardData";

type DashboardSidebarProps = {
  folders: LearningFolder[];
  activeFolderId: string;
  activeView: DashboardView;
  onSelectFolder: (folderId: string) => void;
  onSelectView: (view: Exclude<DashboardView, "field">) => void;
  onOpenAddFieldModal: () => void;
  messagesUnreadCount?: number;
  loadingFolderId?: string | null;
};

type UtilityItem = {
  id: Exclude<DashboardView, "field">;
  label: string;
};

const UTILITY_ITEMS: UtilityItem[] = [
  { id: "profile", label: "Profile" },
  { id: "friends", label: "Friends" },
  { id: "messages", label: "Messages" },
  { id: "more", label: "More" },
];

function UtilityIcon({ item }: { item: UtilityItem["id"] }) {
  if (item === "profile") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19c1.8-3.2 4.1-4.8 6.5-4.8s4.7 1.6 6.5 4.8" />
      </svg>
    );
  }

  if (item === "friends") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="8" cy="9" r="2.3" />
        <circle cx="16" cy="8" r="2.1" />
        <path d="M3.8 18c1.2-2.1 2.7-3.2 4.2-3.2S11 15.9 12.2 18" />
        <path d="M13 17.6c.9-1.7 2.1-2.7 3.4-2.7 1.3 0 2.6 1 3.8 2.9" />
      </svg>
    );
  }

  if (item === "messages") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3.5" y="6.2" width="17" height="11.6" rx="2.1" />
        <path d="M4.4 7.1l7.2 5.7a.65.65 0 0 0 .8 0l7.2-5.7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </svg>
  );
}

export default function DashboardSidebar({
  folders,
  activeFolderId,
  activeView,
  onSelectFolder,
  onSelectView,
  onOpenAddFieldModal,
  messagesUnreadCount = 0,
  loadingFolderId = null,
}: DashboardSidebarProps) {
  return (
    <>
      <div className="lg:hidden">
        <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-2xl border-2 border-[#1F2937]/10 bg-white/85 p-2 shadow-sm">
          {folders.map((folder) => {
            const isActive = activeView === "field" && activeFolderId === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => onSelectFolder(folder.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border-2 px-3 py-2 text-sm font-bold transition ${
                  isActive
                    ? "border-[#1F2937] bg-[#58CC02] text-white shadow-[0_3px_0_#1f2937]"
                    : "border-[#1F2937]/15 bg-white text-[#1F2937] hover:border-[#58CC02]/40 hover:bg-[#58CC02]/10"
                }`}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#FFD84D] text-[11px] font-extrabold text-[#1F2937]">
                  {folder.iconLabel}
                </span>
                {folder.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onOpenAddFieldModal}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-bold text-[#1F2937] transition hover:border-[#58CC02]/45 hover:bg-[#58CC02]/10"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-[#1F2937]">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M5 7.5h14v9H5z" />
                <path d="M8 7.5v-1.6a1.9 1.9 0 0 1 1.9-1.9h4.2A1.9 1.9 0 0 1 16 5.9v1.6" />
                <path d="M12 10.2v5.6" />
                <path d="M9.2 13h5.6" />
              </svg>
            </span>
            Add Field
          </button>
          {UTILITY_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            const shouldShowBadge = item.id === "messages" && messagesUnreadCount > 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border-2 px-3 py-2 text-sm font-bold transition ${
                  isActive
                    ? "border-[#1F2937] bg-[#FFD84D] text-[#1F2937] shadow-[0_3px_0_#1f2937]"
                    : "border-[#1F2937]/15 bg-white text-[#1F2937] hover:border-[#FFD84D]/60 hover:bg-[#FFD84D]/20"
                }`}
              >
                <span className="relative inline-flex">
                  <UtilityIcon item={item.id} />
                  {shouldShowBadge ? <UnreadBadge count={messagesUnreadCount} /> : null}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <aside className="hidden lg:block">
        <div className="overflow-hidden rounded-[1.8rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_10px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.12)]">
          <p className="rounded-full border-2 border-[#1F2937]/15 bg-[#F6FCFF] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Learning Folders
          </p>

          <div className="mt-4 space-y-3">
            {folders.map((folder) => {
              const isActive = activeView === "field" && activeFolderId === folder.id;
              const isLoadingMilestones = loadingFolderId === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => onSelectFolder(folder.id)}
                  className={`group w-full rounded-2xl border-2 px-3 py-3 text-left transition ${
                    isActive
                      ? "border-[#1F2937] bg-[#58CC02]/15 shadow-[0_4px_0_#1f2937]"
                      : "border-[#1F2937]/12 bg-white hover:-translate-y-0.5 hover:border-[#58CC02]/45 hover:shadow-[0_4px_0_rgba(88,204,2,0.25)]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#1F2937]/15 bg-[#FFD84D] text-xs font-extrabold text-[#1F2937]">
                      {folder.iconLabel}
                    </span>
                    <div>
                      <p className="text-sm font-extrabold text-[#1F2937]">{folder.name}</p>
                      <p className="text-xs font-semibold text-[#1F2937]/60">
                        {isLoadingMilestones
                          ? "Loading milestones..."
                          : `${folder.completedSteps}/${folder.totalSteps} milestones`}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              onClick={onOpenAddFieldModal}
              className="group w-full rounded-2xl border-2 border-dashed border-[#1F2937]/18 bg-[#F6FCFF] px-3 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#58CC02]/45 hover:bg-[#F0FFE3]"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-[#1F2937]/15 bg-[#FFD84D] text-[#1F2937]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M4.5 8h15v9.5h-15z" />
                    <path d="M7.5 8V6.4A1.9 1.9 0 0 1 9.4 4.5h5.2a1.9 1.9 0 0 1 1.9 1.9V8" />
                    <path d="M12 11v5.8" />
                    <path d="M9.1 13.9h5.8" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-extrabold text-[#1F2937]">Add Learning Field</p>
                  <p className="text-xs font-semibold text-[#1F2937]/60">
                    Create another folder for your journey
                  </p>
                </div>
              </div>
            </button>
          </div>

          <div className="mt-6 border-t-2 border-dashed border-[#1F2937]/10 pt-5">
            <p className="rounded-full border-2 border-[#1F2937]/15 bg-[#FFF9DD] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/70">
              Utilities
            </p>
            <div className="mt-4 space-y-2.5">
              {UTILITY_ITEMS.map((item) => {
                const isActive = activeView === item.id;
                const shouldShowBadge = item.id === "messages" && messagesUnreadCount > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectView(item.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition ${
                      isActive
                        ? "border-[#1F2937] bg-[#FFD84D]/40 shadow-[0_4px_0_#1f2937]"
                        : "border-[#1F2937]/12 bg-white hover:border-[#FFD84D]/60 hover:bg-[#FFF7D6]"
                    }`}
                  >
                    <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#58CC02]/15 text-[#1F2937]">
                      <UtilityIcon item={item.id} />
                      {shouldShowBadge ? <UnreadBadge count={messagesUnreadCount} /> : null}
                    </span>
                    <span className="text-sm font-extrabold text-[#1F2937]">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
