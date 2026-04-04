import DashboardHeader from "@/components/DashboardHeader";
import WeaknessConceptDrillPage from "@/components/WeaknessConceptDrillPage";
import { resolveAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { redirect } from "next/navigation";

type WeaknessPageProps = {
  params: Promise<{
    courseId: string;
    conceptTag: string;
  }>;
};

export default async function WeaknessPage({ params }: WeaknessPageProps) {
  const sessionResolution = await resolveAuthenticatedSessionUser();
  if (!sessionResolution.authenticated) {
    redirect("/auth-gate");
  }

  const avatarInitial = sessionResolution.user.username?.trim().charAt(0).toUpperCase() || "M";
  let avatarUrl: string | null = null;
  const { data: avatarRow } = await supabaseAdmin
    .from("users")
    .select("avatar_url")
    .eq("id", sessionResolution.user.id)
    .limit(1)
    .maybeSingle<{ avatar_url: string | null }>();
  avatarUrl = (avatarRow?.avatar_url ?? "").trim() || null;

  const { courseId, conceptTag } = await params;

  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <DashboardHeader avatarInitial={avatarInitial} avatarUrl={avatarUrl} />
      <WeaknessConceptDrillPage courseId={courseId} conceptTag={conceptTag} />
    </div>
  );
}
