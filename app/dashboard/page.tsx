import DashboardHeader from "@/components/DashboardHeader";
import DashboardShell from "@/components/DashboardShell";
import { resolveAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { redirect } from "next/navigation";

type DashboardPageProps = {
  searchParams?: Promise<{
    field?: string | string[];
  }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const sessionResolution = await resolveAuthenticatedSessionUser();
  if (!sessionResolution.authenticated) {
    redirect("/auth-gate");
  }
  const avatarInitial = sessionResolution.user.username?.trim().charAt(0).toUpperCase() || "M";

  const resolvedSearchParams = await searchParams;
  const rawField = resolvedSearchParams?.field;
  const initialSelectedField =
    typeof rawField === "string" ? rawField : Array.isArray(rawField) ? rawField[0] : "";

  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <DashboardHeader avatarInitial={avatarInitial} />

      <main className="relative overflow-hidden pb-12 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-4%] top-24 h-36 w-36 rounded-full bg-[#FFD84D]/22 blur-sm" />
          <div className="absolute right-[-2%] top-36 h-28 w-28 rounded-full bg-[#58CC02]/20 blur-sm" />
          <div className="absolute bottom-0 left-0 h-40 w-72 rounded-tr-[5rem] bg-[#58CC02]/12" />
          <div className="absolute bottom-0 right-0 h-32 w-60 rounded-tl-[5rem] bg-[#FFD84D]/18" />
          <div className="absolute left-[10%] top-20 h-8 w-20 rounded-full bg-white/85" />
          <div className="absolute left-[16%] top-16 h-10 w-10 rounded-full bg-white/85" />
          <div className="absolute right-[14%] top-14 h-9 w-24 rounded-full bg-white/80" />
          <div className="absolute right-[18%] top-10 h-12 w-12 rounded-full bg-white/80" />
        </div>

        <DashboardShell
          key={initialSelectedField || "default-road"}
          initialSelectedField={initialSelectedField}
        />
      </main>
    </div>
  );
}
