import type { LearningFolder } from "@/components/dashboardData";

type DashboardSummaryCardsProps = {
  folder: LearningFolder;
  isLoading?: boolean;
};

function LoadingCard() {
  return (
    <article className="rounded-3xl border-2 border-[#1F2937]/15 bg-white p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)]">
      <div className="h-3 w-24 rounded-full bg-[#1F2937]/10" />
      <div className="mt-3 h-7 w-36 rounded-full bg-[#1F2937]/10" />
      <div className="mt-3 h-3 w-28 rounded-full bg-[#1F2937]/10" />
    </article>
  );
}

export default function DashboardSummaryCards({ folder, isLoading = false }: DashboardSummaryCardsProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <article className="rounded-3xl border-2 border-[#1F2937]/15 bg-white p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)] transition hover:-translate-y-0.5">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
          Current Field
        </p>
        <p className="mt-2 text-xl font-extrabold text-[#1F2937]">{folder.name}</p>
        <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
          Level: {folder.currentLevel}
        </p>
      </article>

      <article className="rounded-3xl border-2 border-[#1F2937]/15 bg-white p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)] transition hover:-translate-y-0.5">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
          Progress
        </p>
        <p className="mt-2 text-xl font-extrabold text-[#1F2937]">{folder.progress}%</p>
        <div className="mt-2 h-3 rounded-full bg-[#1F2937]/10">
          <div
            className="h-full rounded-full bg-[#58CC02] transition-all duration-300"
            style={{ width: `${folder.progress}%` }}
          />
        </div>
      </article>

      <article className="rounded-3xl border-2 border-[#1F2937]/15 bg-white p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)] transition hover:-translate-y-0.5">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
          Next Milestone
        </p>
        <p className="mt-2 text-base font-extrabold leading-snug text-[#1F2937]">
          {folder.nextMilestone}
        </p>
        <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
          Target: {folder.targetLevel}
        </p>
      </article>
    </div>
  );
}
