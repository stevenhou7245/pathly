"use client";

import { useEffect } from "react";

type AvatarPreviewModalProps = {
  isOpen: boolean;
  avatarUrl?: string | null;
  fallbackInitial: string;
  displayName: string;
  onClose: () => void;
  positionMode?: "default" | "dashboard";
};

export default function AvatarPreviewModal({
  isOpen,
  avatarUrl,
  fallbackInitial,
  displayName,
  onClose,
  positionMode = "default",
}: AvatarPreviewModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const normalizedInitial = fallbackInitial.trim().charAt(0).toUpperCase() || "M";
  const normalizedAvatarUrl = avatarUrl?.trim() || "";
  const overlayPositionClass =
    positionMode === "dashboard"
      ? "items-center pt-48 pb-8 sm:pt-52 sm:pb-10"
      : "items-center";

  return (
    <div
      className={`fixed inset-0 z-[120] flex justify-center bg-black/45 px-4 motion-modal-overlay ${overlayPositionClass}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-sm rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] motion-modal-content"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Avatar preview"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#1F2937]/20 bg-white text-base font-extrabold text-[#1F2937] transition hover:bg-[#F6FCFF]"
          aria-label="Close avatar preview"
        >
          ×
        </button>

        <p className="text-center text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
          Avatar Preview
        </p>
        <p className="mt-1 text-center text-sm font-semibold text-[#1F2937]/75">{displayName}</p>

        <div className="mt-4 flex justify-center">
          {normalizedAvatarUrl ? (
            <img
              src={normalizedAvatarUrl}
              alt={`${displayName} avatar`}
              className="h-56 w-56 rounded-full border-2 border-[#1F2937]/15 object-cover"
            />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-6xl font-extrabold text-[#1F2937]">
              {normalizedInitial}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
