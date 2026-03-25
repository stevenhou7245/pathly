"use client";

import AvatarPreviewModal from "@/components/AvatarPreviewModal";
import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type DashboardHeaderProps = {
  avatarInitial?: string;
  avatarUrl?: string | null;
};

export default function DashboardHeader({
  avatarInitial = "M",
  avatarUrl = null,
}: DashboardHeaderProps) {
  const router = useRouter();
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const normalizedAvatarInitial = avatarInitial.trim().charAt(0).toUpperCase() || "M";
  const normalizedAvatarUrl = avatarUrl?.trim() || "";

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
          <button
            type="button"
            onClick={() => setIsAvatarPreviewOpen(true)}
            className="rounded-full transition hover:scale-[1.02]"
            aria-label="Preview avatar"
          >
            {normalizedAvatarUrl ? (
              <img
                src={normalizedAvatarUrl}
                alt="My avatar"
                className="h-10 w-10 rounded-full border-2 border-[#1F2937]/20 object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#1F2937]/20 bg-[#FFD84D] text-sm font-extrabold text-[#1F2937]">
                {normalizedAvatarInitial}
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 text-base"
          >
            Logout
          </button>
        </div>
      </nav>

      <AvatarPreviewModal
        isOpen={isAvatarPreviewOpen}
        avatarUrl={normalizedAvatarUrl}
        fallbackInitial={normalizedAvatarInitial}
        displayName="My Avatar"
        positionMode="dashboard"
        onClose={() => setIsAvatarPreviewOpen(false)}
      />
    </header>
  );
}

