"use client";

import type { LearningFolder } from "@/components/dashboardData";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ProfilePanelProps = {
  folder: LearningFolder;
};

type ProfileData = {
  username: string;
  email: string;
  age: number | null;
  avatar_url: string | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
  motto: string | null;
  current_learning_field: string | null;
  current_level: string | null;
  target_level: string | null;
  current_progress: number;
};

type ProfileApiResponse = {
  success: boolean;
  message?: string;
  profile?: {
    username: string;
    email: string;
    age: number | null;
    avatar_url: string | null;
    avatar_path: string | null;
    avatar_updated_at: string | null;
    motto: string | null;
    current_learning_field: string | null;
    current_level: string | null;
    target_level: string | null;
    current_progress: number;
  };
};

type AvatarUploadApiResponse = {
  success: boolean;
  message?: string;
  avatar_url?: string | null;
  avatar_path?: string | null;
  avatar_updated_at?: string | null;
};

type JourneySummaryLesson = {
  title: string;
  stepNumber: number;
  completedAt: string;
  learningFieldName: string;
};

type JourneySummaryApiResponse = {
  success: boolean;
  message?: string;
  data?: {
    headline: string;
    items: JourneySummaryLesson[];
  };
};

type FlagAnchor = {
  x: number;
  y: number;
};

type EditProfileValues = {
  username: string;
  age: string;
  motto: string;
};

const EMPTY_MOTTO_TEXT = "No motto right now.";
const PROFILE_REQUEST_CACHE_TTL_MS = 2500;
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const profileRequestInFlight = new Map<string, Promise<unknown>>();
const profileRequestCache = new Map<string, { expiresAt: number; data: unknown }>();

async function fetchProfileJsonWithDedupe<T>(params: {
  key: string;
  url: string;
  init?: RequestInit;
  ttlMs?: number;
}) {
  const now = Date.now();
  const cached = profileRequestCache.get(params.key);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const inFlight = profileRequestInFlight.get(params.key);
  if (inFlight) {
    return (await inFlight) as T;
  }

  const promise = (async () => {
    const response = await fetch(params.url, params.init);
    const payload = (await response.json()) as unknown;
    if (response.ok) {
      profileRequestCache.set(params.key, {
        data: payload,
        expiresAt: Date.now() + (params.ttlMs ?? PROFILE_REQUEST_CACHE_TTL_MS),
      });
    }
    return payload;
  })();

  profileRequestInFlight.set(params.key, promise);
  try {
    return (await promise) as T;
  } finally {
    profileRequestInFlight.delete(params.key);
  }
}

function toInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "M";
}

function formatCompletedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown completion time";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatShortDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function getFlagRatios(count: number) {
  if (count <= 0) {
    return [] as number[];
  }
  if (count === 1) {
    return [0.55];
  }
  if (count === 2) {
    return [0.35, 0.75];
  }
  return [0.3, 0.6, 0.9];
}

function validateEditProfile(values: EditProfileValues) {
  const username = values.username.trim();
  if (username.length < 3 || username.length > 20) {
    return "Username must be between 3 and 20 characters.";
  }
  if (!/^[A-Za-z0-9]+$/.test(username)) {
    return "Username can only contain letters and numbers.";
  }

  const ageValue = values.age.trim();
  if (ageValue) {
    if (!/^\d+$/.test(ageValue)) {
      return "Age must be a positive integer.";
    }
    const ageNumber = Number(ageValue);
    if (!Number.isInteger(ageNumber) || ageNumber <= 0) {
      return "Age must be a positive integer.";
    }
  }

  if (values.motto.trim().length > 200) {
    return "Motto must be 200 characters or fewer.";
  }

  return "";
}

export default function ProfilePanel({ folder }: ProfilePanelProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarUploadError, setAvatarUploadError] = useState("");
  const [avatarUploadSuccessMessage, setAvatarUploadSuccessMessage] = useState("");
  const [editError, setEditError] = useState("");
  const [saveSuccessMessage, setSaveSuccessMessage] = useState("");
  const [recentCompletedLessons, setRecentCompletedLessons] = useState<JourneySummaryLesson[]>(
    [],
  );
  const [isLoadingJourneySummary, setIsLoadingJourneySummary] = useState(true);
  const [journeySummaryError, setJourneySummaryError] = useState("");
  const [journeyHeadline, setJourneyHeadline] = useState(
    "You are building steady momentum this week.",
  );
  const [flagAnchors, setFlagAnchors] = useState<FlagAnchor[]>([]);
  const [editValues, setEditValues] = useState<EditProfileValues>({
    username: "",
    age: "",
    motto: "",
  });
  const journeyPathRef = useRef<SVGPathElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const loadProfile = useCallback(async () => {
    setIsLoadingProfile(true);
    setProfileError("");

    try {
      const payload = await fetchProfileJsonWithDedupe<ProfileApiResponse>({
        key: "profile:data",
        url: "/api/profile",
        init: {
          method: "GET",
          cache: "no-store",
        },
      });

      if (!payload.success || !payload.profile) {
        throw new Error(payload.message ?? "Unable to load profile right now.");
      }

      setProfile({
        username: payload.profile.username,
        email: payload.profile.email,
        age: payload.profile.age,
        avatar_url: payload.profile.avatar_url,
        avatar_path: payload.profile.avatar_path,
        avatar_updated_at: payload.profile.avatar_updated_at,
        motto: payload.profile.motto,
        current_learning_field: payload.profile.current_learning_field,
        current_level: payload.profile.current_level,
        target_level: payload.profile.target_level,
        current_progress: payload.profile.current_progress,
      });
      setProfileError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load profile right now.";
      setProfileError(message);
    } finally {
      setIsLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const loadJourneySummary = useCallback(async () => {
    setIsLoadingJourneySummary(true);
    setJourneySummaryError("");

    try {
      const payload = await fetchProfileJsonWithDedupe<JourneySummaryApiResponse>({
        key: "profile:journey-summary",
        url: "/api/profile/journey-summary",
        init: {
          method: "GET",
          cache: "no-store",
        },
      });
      if (!payload.success) {
        throw new Error(payload.message ?? "Unable to load journey summary right now.");
      }

      setRecentCompletedLessons(payload.data?.items ?? []);
      setJourneyHeadline(
        payload.data?.headline ?? "You are building steady momentum this week.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load journey summary right now.";
      setJourneySummaryError(message);
      setRecentCompletedLessons([]);
      setJourneyHeadline("You are building steady momentum this week.");
    } finally {
      setIsLoadingJourneySummary(false);
    }
  }, []);

  useEffect(() => {
    void loadJourneySummary();
  }, [loadJourneySummary]);

  useEffect(() => {
    const updateFlagAnchors = () => {
      const path = journeyPathRef.current;
      if (!path) {
        setFlagAnchors([]);
        return;
      }

      const count = Math.min(3, recentCompletedLessons.length);
      if (count === 0) {
        setFlagAnchors([]);
        return;
      }

      const totalLength = path.getTotalLength();
      const anchors = getFlagRatios(count).map((ratio) => {
        const point = path.getPointAtLength(totalLength * ratio);
        return {
          x: point.x,
          y: point.y,
        };
      });
      setFlagAnchors(anchors);
    };

    updateFlagAnchors();
    window.addEventListener("resize", updateFlagAnchors);
    return () => {
      window.removeEventListener("resize", updateFlagAnchors);
    };
  }, [recentCompletedLessons]);

  const displayedMotto = useMemo(() => {
    const motto = profile?.motto?.trim();
    return motto ? motto : EMPTY_MOTTO_TEXT;
  }, [profile?.motto]);

  const displayedLearningField = useMemo(() => {
    const profileField = profile?.current_learning_field?.trim();
    if (profileField) {
      return profileField;
    }

    if (folder.name === "No Learning Field") {
      return "No learning field yet";
    }

    return folder.name;
  }, [folder.name, profile?.current_learning_field]);

  const displayedCurrentLevel = useMemo(() => {
    const value = profile?.current_level?.trim();
    if (value) {
      return value;
    }

    if (folder.name === "No Learning Field") {
      return "Not set";
    }

    return folder.currentLevel;
  }, [folder.currentLevel, folder.name, profile?.current_level]);

  const displayedTargetLevel = useMemo(() => {
    const value = profile?.target_level?.trim();
    if (value) {
      return value;
    }

    if (folder.name === "No Learning Field") {
      return "Not set";
    }

    return folder.targetLevel;
  }, [folder.name, folder.targetLevel, profile?.target_level]);

  const displayedProgress = useMemo(() => {
    if (typeof profile?.current_progress === "number" && Number.isFinite(profile.current_progress)) {
      return Math.max(0, Math.min(100, profile.current_progress));
    }

    if (folder.name === "No Learning Field") {
      return 0;
    }

    return folder.progress;
  }, [folder.name, folder.progress, profile?.current_progress]);

  function openEditModal() {
    if (!profile) {
      return;
    }
    setEditValues({
      username: profile.username,
      age: profile.age === null ? "" : String(profile.age),
      motto: profile.motto ?? "",
    });
    setEditError("");
    setSaveSuccessMessage("");
    setIsEditModalOpen(true);
  }

  function closeEditModal() {
    if (isSavingProfile) {
      return;
    }
    setIsEditModalOpen(false);
  }

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveSuccessMessage("");

    const validationError = validateEditProfile(editValues);
    if (validationError) {
      setEditError(validationError);
      return;
    }

    setIsSavingProfile(true);
    setEditError("");

    try {
      const username = editValues.username.trim();
      const ageRaw = editValues.age.trim();
      const mottoRaw = editValues.motto.trim();

      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          age: ageRaw ? Number(ageRaw) : null,
          motto: mottoRaw || null,
        }),
      });

      const payload = (await response.json()) as ProfileApiResponse;
      if (!response.ok || !payload.success || !payload.profile) {
        throw new Error(payload.message ?? "Unable to update profile right now.");
      }

      profileRequestCache.set("profile:data", {
        data: payload,
        expiresAt: Date.now() + PROFILE_REQUEST_CACHE_TTL_MS,
      });

      setProfile({
        username: payload.profile.username,
        email: payload.profile.email,
        age: payload.profile.age,
        avatar_url: payload.profile.avatar_url,
        avatar_path: payload.profile.avatar_path,
        avatar_updated_at: payload.profile.avatar_updated_at,
        motto: payload.profile.motto,
        current_learning_field: payload.profile.current_learning_field,
        current_level: payload.profile.current_level,
        target_level: payload.profile.target_level,
        current_progress: payload.profile.current_progress,
      });
      setSaveSuccessMessage("Profile updated successfully.");
      setIsEditModalOpen(false);
      await loadProfile();
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update profile right now.";
      setEditError(message);
    } finally {
      setIsSavingProfile(false);
    }
  }

  function openAvatarFilePicker() {
    if (isUploadingAvatar || isLoadingProfile) {
      return;
    }
    avatarInputRef.current?.click();
  }

  async function handleAvatarFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!selectedFile) {
      return;
    }

    setAvatarUploadError("");
    setAvatarUploadSuccessMessage("");

    if (!ALLOWED_AVATAR_MIME_TYPES.has(selectedFile.type)) {
      setAvatarUploadError("Only JPEG, PNG, and WEBP images are allowed.");
      return;
    }

    if (selectedFile.size <= 0 || selectedFile.size > MAX_AVATAR_SIZE_BYTES) {
      setAvatarUploadError("Image is too large. Maximum size is 5MB.");
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as AvatarUploadApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to upload avatar right now.");
      }

      setProfile((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          avatar_url: (payload.avatar_url ?? "").trim() || null,
          avatar_path: (payload.avatar_path ?? "").trim() || null,
          avatar_updated_at: (payload.avatar_updated_at ?? "").trim() || new Date().toISOString(),
        };
      });
      profileRequestCache.delete("profile:data");
      setAvatarUploadSuccessMessage("Avatar updated successfully.");
      await loadProfile();
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to upload avatar right now.";
      setAvatarUploadError(message);
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={openAvatarFilePicker}
                disabled={isUploadingAvatar || isLoadingProfile}
                className="group relative rounded-full border-2 border-[#1F2937] bg-[#FFD84D] transition disabled:cursor-not-allowed disabled:opacity-70"
                aria-label="Upload avatar"
              >
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={`${profile.username} avatar`}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center text-xl font-extrabold text-[#1F2937]">
                    {toInitial(profile?.username ?? "M")}
                  </span>
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-full bg-[#1F2937]/75 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white opacity-0 transition group-hover:opacity-100">
                  Upload
                </span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarFileChange}
                className="hidden"
              />
              <p className="text-[11px] font-semibold text-[#1F2937]/65">
                {isUploadingAvatar ? "Uploading..." : "Click avatar to upload"}
              </p>
            </div>
            <div>
              <h2 className="text-3xl font-extrabold text-[#1F2937]">My Profile</h2>
              <p className="text-sm font-semibold text-[#1F2937]/70">
                Every learner follows a unique path.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openEditModal}
            disabled={isLoadingProfile || !profile}
            className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-base disabled:cursor-not-allowed disabled:opacity-70"
          >
            Edit Profile
          </button>
        </div>

        {profileError ? (
          <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
            {profileError}
          </p>
        ) : null}
        {avatarUploadError ? (
          <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
            {avatarUploadError}
          </p>
        ) : null}
        {saveSuccessMessage ? (
          <p className="mt-4 rounded-xl bg-[#f1fff1] px-3 py-2 text-sm font-semibold text-[#2e7d32]">
            {saveSuccessMessage}
          </p>
        ) : null}
        {avatarUploadSuccessMessage ? (
          <p className="mt-4 rounded-xl bg-[#f1fff1] px-3 py-2 text-sm font-semibold text-[#2e7d32]">
            {avatarUploadSuccessMessage}
          </p>
        ) : null}

        {isLoadingProfile ? (
          <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-5 text-sm font-semibold text-[#1F2937]/70">
            Loading profile...
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F6FCFF] p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Username
                </p>
                <p className="mt-2 text-xl font-extrabold text-[#1F2937]">
                  {profile?.username ?? "Unknown"}
                </p>
              </article>
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#FFF9DD] p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Age
                </p>
                <p className="mt-2 text-xl font-extrabold text-[#1F2937]">
                  {profile?.age ?? "Not set"}
                </p>
              </article>
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Current Learning Field
                </p>
                <p className="mt-2 text-xl font-extrabold text-[#1F2937]">{displayedLearningField}</p>
              </article>
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Current Progress
                </p>
                <p className="mt-2 text-xl font-extrabold text-[#1F2937]">{displayedProgress}%</p>
              </article>
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Current Level
                </p>
                <p className="mt-2 text-xl font-extrabold text-[#1F2937]">{displayedCurrentLevel}</p>
              </article>
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Target Level
                </p>
                <p className="mt-2 text-xl font-extrabold text-[#1F2937]">{displayedTargetLevel}</p>
              </article>
            </div>

            <article className="mt-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#FFF9DD] p-4">
              <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                Motto
              </p>
              <p className="mt-2 text-base font-semibold text-[#1F2937]">{displayedMotto}</p>
            </article>
          </>
        )}

        <div className="mt-5">
          <p className="text-sm font-bold text-[#1F2937]">Journey Progress</p>
          <div className="mt-2 h-4 rounded-full bg-[#1F2937]/10">
            <div
              className="h-full rounded-full bg-[#58CC02] transition-all duration-300"
              style={{ width: `${displayedProgress}%` }}
            />
          </div>
          <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">
            {displayedProgress}% completed on your current learning field
          </p>
        </div>
      </div>

      <div className="rounded-[2rem] border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_6px_0_rgba(31,41,55,0.08)] sm:p-6">
        <h3 className="text-xl font-extrabold text-[#1F2937]">Journey Summary</h3>
        <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">{journeyHeadline}</p>

        <div className="mt-4 overflow-hidden rounded-3xl border-2 border-[#1F2937]/12 bg-[#F7FCFF] p-4">
          <svg
            viewBox="0 0 760 150"
            className="h-auto w-full"
            role="img"
            aria-label="Road and milestone summary graphic"
          >
            <path d="M32 114 C130 56 260 48 356 84 C478 130 604 116 724 44" stroke="#FFF2A8" strokeWidth="48" strokeLinecap="round" fill="none" />
            <path
              ref={journeyPathRef}
              d="M44 114 C140 62 260 56 352 90 C474 138 600 120 718 52"
              stroke="#F3CF22"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeDasharray="10 12"
              fill="none"
            />
            {recentCompletedLessons.slice(0, 3).map((lesson, index) => {
              const anchor = flagAnchors[index];
              if (!anchor) {
                return null;
              }

              const poleHeight = 28;
              const poleWidth = 12;
              const poleX = anchor.x - poleWidth / 2;
              const poleY = anchor.y - poleHeight;
              const flagMidY = poleY + 8;
              const dateLabelY = Math.min(136, anchor.y + 18);
              const titleLabelY = Math.min(148, anchor.y + 30);

              return (
                <g key={`${lesson.stepNumber}-${lesson.completedAt}-${index}`}>
                  <rect
                    x={poleX}
                    y={poleY}
                    width={poleWidth}
                    height={poleHeight}
                    rx="4"
                    fill="#58CC02"
                  />
                  <polygon
                    points={`${poleX + poleWidth},${flagMidY - 8} ${poleX + 34},${flagMidY} ${
                      poleX + poleWidth
                    },${flagMidY + 8}`}
                    fill="#FFD84D"
                  />
                  <text
                    x={anchor.x}
                    y={dateLabelY}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill="#1F2937"
                  >
                    {formatShortDate(lesson.completedAt)}
                  </text>
                  <text
                    x={anchor.x}
                    y={titleLabelY}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="700"
                    fill="#1F2937"
                  >
                    {truncateText(lesson.title, 24)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="mt-4 space-y-3">
          {journeySummaryError ? (
            <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
              {journeySummaryError}
            </p>
          ) : null}

          {isLoadingJourneySummary ? (
            <p className="rounded-xl border-2 border-[#1F2937]/12 bg-white px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
              Loading recent completed lessons...
            </p>
          ) : null}

          {!isLoadingJourneySummary && !journeySummaryError ? (
            recentCompletedLessons.length > 0 ? (
              recentCompletedLessons.map((lesson, index) => (
                <article
                  key={`${lesson.learningFieldName}-${lesson.stepNumber}-${lesson.completedAt}-${index}`}
                  className="rounded-2xl border-2 border-[#1F2937]/12 bg-white px-4 py-3"
                >
                  <p className="text-sm font-extrabold text-[#1F2937]">{lesson.title}</p>
                  <p className="mt-1 text-xs font-semibold text-[#1F2937]/65">
                    Completed at: {formatCompletedAt(lesson.completedAt)}
                  </p>
                </article>
              ))
            ) : (
              <p className="rounded-xl border-2 border-dashed border-[#1F2937]/18 bg-white px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
                No completed lessons yet.
              </p>
            )
          ) : null}
        </div>
      </div>

      {isEditModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-lg rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <h3 className="text-2xl font-extrabold text-[#1F2937]">Edit Profile</h3>
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
              Update your username, age, and motto.
            </p>

            <form className="mt-5 space-y-4" onSubmit={handleSaveProfile}>
              <div>
                <label className="mb-2 block text-sm font-bold text-[#1F2937]">Username</label>
                <input
                  type="text"
                  value={editValues.username}
                  onChange={(event) =>
                    setEditValues((previous) => ({
                      ...previous,
                      username: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
                  placeholder="Username"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-[#1F2937]">Age (optional)</label>
                <input
                  type="number"
                  min={1}
                  value={editValues.age}
                  onChange={(event) =>
                    setEditValues((previous) => ({
                      ...previous,
                      age: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
                  placeholder="e.g. 20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-[#1F2937]">Motto (optional)</label>
                <textarea
                  value={editValues.motto}
                  onChange={(event) =>
                    setEditValues((previous) => ({
                      ...previous,
                      motto: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full resize-none rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
                  placeholder="Your short personal quote"
                />
              </div>

              {editError ? (
                <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                  {editError}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={isSavingProfile}
                  className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSavingProfile ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

