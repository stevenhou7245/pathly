"use client";

import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import { useRouter } from "next/navigation";

type DashboardHeaderProps = {
  avatarInitial?: string;
};

export default function DashboardHeader({ avatarInitial = "M" }: DashboardHeaderProps) {
  const router = useRouter();
  const normalizedAvatarInitial = avatarInitial.trim().charAt(0).toUpperCase() || "M";

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } catch {
      // Ignore network errors and continue local redirect.
    } finally {
      router.push("/");
    }
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/5 bg-white/95 shadow-sm backdrop-blur">
      <nav className="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-between gap-3 px-6 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <BrandLogo />
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#1F2937]/20 bg-[#FFD84D] text-sm font-extrabold text-[#1F2937]">
            {normalizedAvatarInitial}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 text-base !text-[#1F2937]"
          >
            Logout
          </button>
        </div>
      </nav>
    </header>
  );
}
