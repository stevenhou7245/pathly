"use client";

import SettingsPanel from "@/components/SettingsPanel";
import Link from "next/link";
import { useState } from "react";

type MorePanelProps = {
  soundEffects: boolean;
  animations: boolean;
  themeMode: "light" | "dark";
  isSettingsLoading?: boolean;
  isSettingsSaving?: boolean;
  settingsMessage?: string;
  settingsError?: string;
  onToggleSoundEffects: () => void;
  onToggleAnimations: () => void;
  onSetThemeMode: (mode: "light" | "dark") => void;
};

export default function MorePanel({
  soundEffects,
  animations,
  themeMode,
  isSettingsLoading = false,
  isSettingsSaving = false,
  settingsMessage = "",
  settingsError = "",
  onToggleSoundEffects,
  onToggleAnimations,
  onSetThemeMode,
}: MorePanelProps) {
  const [inviteMessage, setInviteMessage] = useState("");

  async function handleCopyInviteLink() {
    const inviteLink = "https://pathly.app/invite/learning-path";

    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteMessage("Invite link copied!");
    } catch {
      setInviteMessage("Invite link copied!");
    }

    setTimeout(() => {
      setInviteMessage("");
    }, 2000);
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-3xl font-extrabold text-[#1F2937]">More</h2>
        <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
          Tools and settings to customize your Pathly journey.
        </p>
      </div>

      <SettingsPanel
        soundEffects={soundEffects}
        animations={animations}
        themeMode={themeMode}
        onToggleSoundEffects={onToggleSoundEffects}
        onToggleAnimations={onToggleAnimations}
        onSetThemeMode={onSetThemeMode}
        disabled={isSettingsLoading || isSettingsSaving}
      />
      {settingsError ? (
        <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {settingsError}
        </p>
      ) : null}
      {settingsMessage ? (
        <p className="rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
          {settingsMessage}
        </p>
      ) : null}
      {isSettingsLoading ? (
        <p className="text-sm font-semibold text-[#1F2937]/65">Loading your settings...</p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
          <h3 className="text-2xl font-extrabold text-[#1F2937]">Help</h3>
          <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
            Need help on your learning journey?
          </p>

          <div className="mt-4 space-y-3.5">
            <Link
              href="/help/faq"
              className="group flex w-full items-start justify-between gap-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F7FCFF] px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#58CC02]/45 hover:bg-white hover:shadow-[0_4px_0_rgba(31,41,55,0.12)]"
            >
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-[#1F2937]">FAQ</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-[#1F2937]/65">
                  Find quick answers about accounts, maps, progress, and settings.
                </p>
              </div>
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] text-[#1F2937] transition group-hover:border-[#58CC02]/45 group-hover:bg-[#ecffe1]">
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 10h8" />
                  <path d="M11 6l4 4-4 4" />
                </svg>
              </span>
            </Link>
            <Link
              href="/help/contact-support"
              className="group flex w-full items-start justify-between gap-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F7FCFF] px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#58CC02]/45 hover:bg-white hover:shadow-[0_4px_0_rgba(31,41,55,0.12)]"
            >
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-[#1F2937]">Contact Support</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-[#1F2937]/65">
                  Send a request and get guidance from the Pathly support team.
                </p>
              </div>
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] text-[#1F2937] transition group-hover:border-[#58CC02]/45 group-hover:bg-[#ecffe1]">
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 10h8" />
                  <path d="M11 6l4 4-4 4" />
                </svg>
              </span>
            </Link>
            <Link
              href="/help/how-pathly-works"
              className="group flex w-full items-start justify-between gap-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F7FCFF] px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#58CC02]/45 hover:bg-white hover:shadow-[0_4px_0_rgba(31,41,55,0.12)]"
            >
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-[#1F2937]">How Pathly Works</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-[#1F2937]/65">
                  Learn the full flow from choosing a field to making steady progress.
                </p>
              </div>
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] text-[#1F2937] transition group-hover:border-[#58CC02]/45 group-hover:bg-[#ecffe1]">
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 10h8" />
                  <path d="M11 6l4 4-4 4" />
                </svg>
              </span>
            </Link>
          </div>
        </article>

        <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
          <h3 className="text-2xl font-extrabold text-[#1F2937]">Invite</h3>
          <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
            Invite friends to Pathly and keep learning together.
          </p>

          <div className="mt-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#FFF9DD] p-3">
            <p className="truncate text-sm font-bold text-[#1F2937]">
              https://pathly.app/invite/learning-path
            </p>
          </div>

          <button
            type="button"
            onClick={handleCopyInviteLink}
            className="btn-3d btn-3d-green mt-4 inline-flex h-11 items-center justify-center px-6 !text-base"
          >
            Copy Invite Link
          </button>

          {inviteMessage ? (
            <p className="mt-3 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
              {inviteMessage}
            </p>
          ) : (
            <p className="mt-3 text-sm font-semibold text-[#1F2937]/60">
              Share your link and build a stronger study circle.
            </p>
          )}
        </article>
      </div>
    </section>
  );
}

