"use client";

import DashboardSidebar from "@/components/DashboardSidebar";
import DashboardSummaryCards from "@/components/DashboardSummaryCards";
import FriendsPanel from "@/components/FriendsPanel";
import LearningFieldPanel from "@/components/LearningFieldPanel";
import MessagesPanel from "@/components/MessagesPanel";
import NotebookPanel from "@/components/NotebookPanel";
import MorePanel from "@/components/MorePanel";
import ProfilePanel from "@/components/ProfilePanel";
import StudyRoomsPanel, { type StudyRoomListItem } from "@/components/StudyRoomsPanel";
import {
  type DashboardView,
  type LearningFolder,
} from "@/components/dashboardData";
import { playSound, setSoundEffectsEnabled as syncSoundEffectsEnabled } from "@/lib/sound";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DashboardShellProps = {
  initialSelectedField?: string;
};

type UserLearningFieldSummary = {
  id: string;
  fieldId?: string;
  field_id?: string;
  title?: string;
  field_title?: string;
  currentLevel?: string | null;
  current_level?: string | null;
  targetLevel?: string | null;
  target_level?: string | null;
  activeRouteId?: string | null;
  active_route_id?: string | null;
  totalSteps?: number;
  total_steps?: number;
  currentStepIndex?: number;
  current_step_index?: number;
  progressPercent?: number;
  created_at?: string | null;
  started_at?: string | null;
  completed_steps_count?: number;
  total_steps_count?: number;
  percentage_progress?: number;
};

type UserLearningFieldsApiResponse = {
  success: boolean;
  message?: string;
  learning_fields?: UserLearningFieldSummary[];
  learningFields?: UserLearningFieldSummary[];
};

type CreateLearningFieldApiResponse = {
  success: boolean;
  message?: string;
  learning_field?: {
    id?: unknown;
  };
  generation?: {
    source: "ai" | "fallback" | "database";
    generated: boolean;
  };
  learning_steps?: Array<{
    id: string;
    step_number: number;
    title: string;
    summary: string | null;
    resources: Array<{
      type: "video" | "article" | "tutorial" | "interactive" | "document";
      title: string;
      url: string;
    }>;
  }>;
};

type DeleteLearningFieldApiResponse = {
  success: boolean;
  message?: string;
};

type MessagesSummaryApiResponse = {
  success?: boolean;
  message?: string;
  current_user_id?: string;
  accepted_friendship_ids?: string[];
  unread_friend_messages?: number;
  pending_friend_requests?: number;
  unread_system_messages?: number;
  pending_study_invitations?: number;
  total_unread?: number;
};

type StudyRoomsApiResponse = {
  success: boolean;
  message?: string;
  rooms?: StudyRoomListItem[];
};

type LearningSummaryApiResponse = {
  success: boolean;
  message?: string;
  field?: {
    id: string;
    title: string;
    level: string | null;
    destination: string | null;
    user_learning_field_id: string | null;
  };
  journey?: {
    journey_path_id: string;
    total_steps: number;
    completed_steps: number;
    current_step: number;
    progress_percent: number;
  };
  folder_summary?: {
    completed_milestones: number;
    total_milestones: number;
  };
};

type ProfileSettingsApiResponse = {
  success: boolean;
  message?: string;
  settings?: {
    theme: "light" | "dark";
    sound_effects_enabled: boolean;
    animations_enabled: boolean;
  };
};

type ProfileSettingsPatch = {
  theme?: "light" | "dark";
  sound_effects_enabled?: boolean;
  animations_enabled?: boolean;
};

type AddFieldValues = {
  learningGoal: string;
  currentLevel: string;
  targetLevel: string;
};

type JsonCacheEntry = {
  expiresAt: number;
  data: unknown;
};

const DASHBOARD_REQUEST_CACHE_TTL_MS = 3000;
const dashboardRequestInFlight = new Map<string, Promise<unknown>>();
const dashboardRequestCache = new Map<string, JsonCacheEntry>();

async function fetchJsonWithRequestDedupe<T>(params: {
  key: string;
  url: string;
  init?: RequestInit;
  ttlMs?: number;
}) {
  const now = Date.now();
  const cached = dashboardRequestCache.get(params.key);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const inFlight = dashboardRequestInFlight.get(params.key);
  if (inFlight) {
    return (await inFlight) as T;
  }

  const fetchPromise = (async () => {
    const response = await fetch(params.url, params.init);
    const payload = (await response.json()) as unknown;
    if (response.ok) {
      dashboardRequestCache.set(params.key, {
        data: payload,
        expiresAt: Date.now() + (params.ttlMs ?? DASHBOARD_REQUEST_CACHE_TTL_MS),
      });
    }
    return payload;
  })();

  dashboardRequestInFlight.set(params.key, fetchPromise);
  try {
    return (await fetchPromise) as T;
  } finally {
    dashboardRequestInFlight.delete(params.key);
  }
}

function resolveBreadcrumbLabel(view: DashboardView, folder: LearningFolder) {
  if (view === "field") {
    return folder.name;
  }
  if (view === "profile") {
    return "Profile";
  }
  if (view === "notes") {
    return "Notes";
  }
  if (view === "friends") {
    return "Friends";
  }
  if (view === "messages") {
    return "Messages";
  }
  if (view === "study_rooms") {
    return "Study Rooms";
  }
  return "More";
}

function normalizeTopicLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toDisplayLevel(value: string | null | undefined, fallback = "Beginner") {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return fallback;
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildNextMilestone(params: {
  totalSteps: number;
  completedSteps: number;
  currentStepIndex: number;
  targetLevel: string;
}) {
  if (params.totalSteps > 0 && params.completedSteps >= params.totalSteps) {
    return "Path completed";
  }

  if (params.totalSteps > 0) {
    const visibleCurrentStep = Math.min(
      Math.max(1, params.currentStepIndex),
      params.totalSteps,
    );
    return `Step ${visibleCurrentStep} of ${params.totalSteps}`;
  }

  return `Reach ${params.targetLevel} level`;
}

function toIconLabel(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "M";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function createPlaceholderFolder(): LearningFolder {
  return {
    id: "empty-folder",
    fieldId: "",
    journeyPathId: null,
    name: "No Learning Field",
    iconLabel: "M",
    currentLevel: "Beginner",
    targetLevel: "Intermediate",
    progress: 0,
    nextMilestone: "Add your first learning field",
    totalSteps: 0,
    completedSteps: 0,
  };
}

function mapSummaryToFolder(summary: UserLearningFieldSummary): LearningFolder {
  const fieldTitle = summary.title ?? summary.field_title ?? "Untitled Field";
  const currentLevel = toDisplayLevel(summary.currentLevel ?? summary.current_level, "Beginner");
  const targetLevel = toDisplayLevel(summary.targetLevel ?? summary.target_level, "Intermediate");
  const progressPercent =
    typeof summary.progressPercent === "number"
      ? summary.progressPercent
      : summary.percentage_progress;

  const totalStepsFromCamel =
    typeof summary.totalSteps === "number" ? summary.totalSteps : undefined;
  const totalStepsFromPath =
    typeof summary.total_steps === "number" ? summary.total_steps : undefined;
  const totalStepsFromSummary =
    typeof summary.total_steps_count === "number" ? summary.total_steps_count : undefined;
  const totalSteps = Math.max(
    0,
    Math.round(totalStepsFromCamel ?? totalStepsFromPath ?? totalStepsFromSummary ?? 0),
  );

  const currentStepIndex =
    typeof summary.currentStepIndex === "number"
      ? summary.currentStepIndex
      : typeof summary.current_step_index === "number"
        ? summary.current_step_index
      : totalSteps > 0
        ? 1
        : 0;

  const completedFromSummary =
    typeof summary.completed_steps_count === "number"
      ? summary.completed_steps_count
      : Math.max(0, currentStepIndex - 1);
  const completedSteps = Math.max(0, Math.min(totalSteps, Math.round(completedFromSummary)));

  const percentage =
    typeof progressPercent === "number"
      ? progressPercent
      : totalSteps === 0
        ? 0
        : Math.round((completedSteps / totalSteps) * 100);
  const progress = Math.max(0, Math.min(100, Math.round(percentage)));

  const nextMilestone = buildNextMilestone({
    totalSteps,
    completedSteps,
    currentStepIndex,
    targetLevel,
  });

  return {
    id: summary.id,
    fieldId: summary.fieldId ?? summary.field_id ?? "",
    journeyPathId: summary.activeRouteId ?? summary.active_route_id ?? null,
    name: fieldTitle,
    iconLabel: toIconLabel(fieldTitle || "M"),
    currentLevel,
    targetLevel,
    progress,
    nextMilestone,
    totalSteps,
    completedSteps,
  };
}

function validateAddField(values: AddFieldValues) {
  if (!values.learningGoal.trim()) {
    return "Please enter what you want to learn.";
  }
  if (!values.currentLevel) {
    return "Please choose your current level.";
  }
  if (!values.targetLevel) {
    return "Please choose your target level.";
  }
  return "";
}

export default function DashboardShell({ initialSelectedField = "" }: DashboardShellProps) {
  const router = useRouter();
  const [folders, setFolders] = useState<LearningFolder[]>([]);
  const [activeView, setActiveView] = useState<DashboardView>("field");
  const [activeFolderId, setActiveFolderId] = useState("");
  const [foldersError, setFoldersError] = useState("");
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isAddFieldModalOpen, setIsAddFieldModalOpen] = useState(false);
  const [isDeleteFieldModalOpen, setIsDeleteFieldModalOpen] = useState(false);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<LearningFolder | null>(null);
  const [addFieldValues, setAddFieldValues] = useState<AddFieldValues>({
    learningGoal: "",
    currentLevel: "",
    targetLevel: "",
  });
  const [isAddingField, setIsAddingField] = useState(false);
  const [isDeletingField, setIsDeletingField] = useState(false);
  const [addFieldError, setAddFieldError] = useState("");
  const [deleteFieldError, setDeleteFieldError] = useState("");
  const [messagesUnreadCount, setMessagesUnreadCount] = useState(0);
  const [friendsUnreadCount, setFriendsUnreadCount] = useState(0);
  const [badgeRealtimeUserId, setBadgeRealtimeUserId] = useState("");
  const [isLoadingActiveSummary, setIsLoadingActiveSummary] = useState(false);
  const [activeSummaryError, setActiveSummaryError] = useState("");
  const [summaryReadyByField, setSummaryReadyByField] = useState<Record<string, boolean>>({});
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(true);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [studyRooms, setStudyRooms] = useState<StudyRoomListItem[]>([]);
  const [activeStudyRoomId, setActiveStudyRoomId] = useState("");
  const [studyRoomsError, setStudyRoomsError] = useState("");
  const activeSummaryRequestIdRef = useRef(0);
  const inFlightSummaryFieldIdsRef = useRef<Set<string>>(new Set());
  const summaryReadyByFieldRef = useRef<Record<string, boolean>>({});
  const initialLoadRequestedRef = useRef(false);
  const hasInitializedUnreadRef = useRef(false);
  const previousUnreadCountRef = useRef(0);
  const acceptedFriendshipIdsRef = useRef<Set<string>>(new Set());

  const loadLearningFields = useCallback(
    async (options?: { preferredField?: string; forceActiveFolderId?: string }) => {
      setIsLoadingFolders(true);
      setFoldersError("");

      try {
        const payload = await fetchJsonWithRequestDedupe<UserLearningFieldsApiResponse>({
          key: "dashboard:learning-fields",
          url: "/api/user/learning-fields",
          init: {
            method: "GET",
            cache: "no-store",
          },
          ttlMs: 2000,
        });

        if (!payload.success) {
          setFoldersError(payload.message ?? "Unable to load your learning fields right now.");
          setIsLoadingFolders(false);
          return;
        }

        const summaries = payload.learning_fields ?? payload.learningFields ?? [];
        const nextFolders = summaries.map((summary) => mapSummaryToFolder(summary));
        setFolders(nextFolders);
        setFoldersError("");
        setIsLoadingFolders(false);

        setActiveFolderId((previous) => {
          if (
            options?.forceActiveFolderId &&
            nextFolders.some((folder) => folder.id === options.forceActiveFolderId)
          ) {
            return options.forceActiveFolderId;
          }

          if (previous && nextFolders.some((folder) => folder.id === previous)) {
            return previous;
          }

          const preferredField = options?.preferredField?.trim() ?? "";
          if (preferredField) {
            const matched = nextFolders.find(
              (folder) => normalizeTopicLabel(folder.name) === normalizeTopicLabel(preferredField),
            );
            if (matched) {
              return matched.id;
            }
          }

          return nextFolders[0]?.id ?? "";
        });
      } catch {
        setFoldersError("Unable to load your learning fields right now.");
        setIsLoadingFolders(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (initialLoadRequestedRef.current) {
      return;
    }
    initialLoadRequestedRef.current = true;

    void loadLearningFields({
      preferredField: initialSelectedField,
    });
  }, [initialSelectedField, loadLearningFields]);

  const loadMessagesUnreadCount = useCallback(async () => {
    try {
      const payload = await fetchJsonWithRequestDedupe<MessagesSummaryApiResponse>({
        key: "dashboard:messages-summary",
        url: "/api/messages/summary",
        init: {
          method: "GET",
          cache: "no-store",
        },
        ttlMs: 250,
      });
      if (typeof payload.total_unread !== "number") {
        return;
      }
      const nextUnread = payload.total_unread ?? 0;
      const nextFriendUnread =
        typeof payload.unread_friend_messages === "number"
          ? Math.max(0, Math.floor(payload.unread_friend_messages))
          : 0;
      const nextCurrentUserId = payload.current_user_id?.trim() ?? "";
      const nextAcceptedFriendshipIds = Array.from(
        new Set((payload.accepted_friendship_ids ?? []).map((value) => value.trim()).filter(Boolean)),
      );
      if (hasInitializedUnreadRef.current && nextUnread > previousUnreadCountRef.current) {
        playSound("notification");
      }
      previousUnreadCountRef.current = nextUnread;
      hasInitializedUnreadRef.current = true;
      setMessagesUnreadCount(nextUnread);
      setFriendsUnreadCount(nextFriendUnread);
      setBadgeRealtimeUserId(nextCurrentUserId);
      acceptedFriendshipIdsRef.current = new Set(nextAcceptedFriendshipIds);
    } catch {
      // Keep existing badge state on network errors.
    }
  }, []);

  useEffect(() => {
    void loadMessagesUnreadCount();
  }, [loadMessagesUnreadCount]);

  useEffect(() => {
    const currentUserId = badgeRealtimeUserId.trim();
    if (!currentUserId) {
      return;
    }

    let active = true;
    let supabaseClient: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try {
      supabaseClient = getSupabaseBrowserClient();
    } catch (error) {
      console.warn("[dashboard_badge_realtime] client_init_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const refreshUnreadBadges = () => {
      if (!active) {
        return;
      }
      void loadMessagesUnreadCount();
    };

    const channel = supabaseClient
      .channel(`dashboard-badges:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_messages",
        },
        (payload) => {
          if (!active) {
            return;
          }
          const row = (payload.new ?? payload.old ?? null) as Record<string, unknown> | null;
          const friendshipId = typeof row?.friendship_id === "string" ? row.friendship_id : "";
          if (!friendshipId) {
            return;
          }
          if (!acceptedFriendshipIdsRef.current.has(friendshipId)) {
            return;
          }
          refreshUnreadBadges();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
          filter: `requester_id=eq.${currentUserId}`,
        },
        refreshUnreadBadges,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
          filter: `addressee_id=eq.${currentUserId}`,
        },
        refreshUnreadBadges,
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[dashboard_badge_realtime] subscription_failed", {
            current_user_id: currentUserId,
            status,
          });
        }
      });

    return () => {
      active = false;
      void channel.unsubscribe();
      if (supabaseClient) {
        void supabaseClient.removeChannel(channel);
      }
    };
  }, [badgeRealtimeUserId, loadMessagesUnreadCount]);

  const loadStudyRooms = useCallback(async () => {
    setStudyRoomsError("");
    try {
      const payload = await fetchJsonWithRequestDedupe<StudyRoomsApiResponse>({
        key: "dashboard:study-rooms",
        url: "/api/study-room/my",
        init: {
          method: "GET",
          cache: "no-store",
        },
        ttlMs: 1500,
      });
      if (!payload.success) {
        throw new Error(payload.message ?? "Unable to load study rooms right now.");
      }

      const nextRooms = payload.rooms ?? [];
      setStudyRooms(nextRooms);
      setActiveStudyRoomId((previous) => {
        if (previous && nextRooms.some((room) => room.id === previous)) {
          return previous;
        }
        return nextRooms[0]?.id ?? "";
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load study rooms.";
      setStudyRoomsError(message);
      setStudyRooms([]);
      setActiveStudyRoomId("");
    }
  }, []);

  useEffect(() => {
    void loadStudyRooms();
  }, [loadStudyRooms]);

  const loadSettings = useCallback(async () => {
    setIsSettingsLoading(true);
    setSettingsError("");
    setSettingsMessage("");

    try {
      const payload = await fetchJsonWithRequestDedupe<ProfileSettingsApiResponse>({
        key: "dashboard:profile-settings",
        url: "/api/profile/settings",
        init: {
          method: "GET",
          cache: "no-store",
        },
        ttlMs: 2000,
      });
      if (!payload.success || !payload.settings) {
        throw new Error(payload.message ?? "Unable to load settings right now.");
      }

      setThemeMode(payload.settings.theme);
      setSoundEffectsEnabled(payload.settings.sound_effects_enabled);
      setAnimationsEnabled(payload.settings.animations_enabled);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load settings right now.";
      setSettingsError(message);
    } finally {
      setIsSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.animations = animationsEnabled ? "on" : "off";
  }, [animationsEnabled]);

  useEffect(() => {
    syncSoundEffectsEnabled(soundEffectsEnabled);
  }, [soundEffectsEnabled]);

  async function patchSettings(patch: ProfileSettingsPatch) {
    const previousTheme = themeMode;
    const previousSound = soundEffectsEnabled;
    const previousAnimations = animationsEnabled;

    if (patch.theme !== undefined) {
      setThemeMode(patch.theme);
    }
    if (patch.sound_effects_enabled !== undefined) {
      setSoundEffectsEnabled(patch.sound_effects_enabled);
    }
    if (patch.animations_enabled !== undefined) {
      setAnimationsEnabled(patch.animations_enabled);
    }

    setIsSettingsSaving(true);
    setSettingsError("");
    setSettingsMessage("");

    try {
      const response = await fetch("/api/profile/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      });
      const payload = (await response.json()) as ProfileSettingsApiResponse;
      if (!response.ok || !payload.success || !payload.settings) {
        throw new Error(payload.message ?? "Unable to update settings right now.");
      }

      setThemeMode(payload.settings.theme);
      setSoundEffectsEnabled(payload.settings.sound_effects_enabled);
      setAnimationsEnabled(payload.settings.animations_enabled);
      setSettingsMessage("Settings saved.");
      if (patch.sound_effects_enabled === true) {
        playSound("click");
      }
      dashboardRequestCache.set("dashboard:profile-settings", {
        data: {
          success: true,
          settings: payload.settings,
        } satisfies ProfileSettingsApiResponse,
        expiresAt: Date.now() + DASHBOARD_REQUEST_CACHE_TTL_MS,
      });
      router.refresh();
    } catch (error) {
      setThemeMode(previousTheme);
      setSoundEffectsEnabled(previousSound);
      setAnimationsEnabled(previousAnimations);
      const message =
        error instanceof Error ? error.message : "Unable to update settings right now.";
      setSettingsError(message);
    } finally {
      setIsSettingsSaving(false);
    }
  }

  function handleToggleSoundEffects() {
    if (soundEffectsEnabled) {
      playSound("click");
    }
    void patchSettings({
      sound_effects_enabled: !soundEffectsEnabled,
    });
  }

  function handleToggleAnimations() {
    void patchSettings({
      animations_enabled: !animationsEnabled,
    });
  }

  function handleSetThemeMode(nextTheme: "light" | "dark") {
    if (nextTheme === themeMode) {
      return;
    }
    void patchSettings({
      theme: nextTheme,
    });
  }

  const hasFolders = folders.length > 0;
  const activeFolder = useMemo<LearningFolder>(() => {
    if (!hasFolders) {
      return createPlaceholderFolder();
    }
    return folders.find((folder) => folder.id === activeFolderId) ?? folders[0];
  }, [activeFolderId, folders, hasFolders]);

  const selectedFromQuery = useMemo(() => {
    if (!initialSelectedField.trim()) {
      return null;
    }
    return (
      folders.find(
        (folder) =>
          normalizeTopicLabel(folder.name) === normalizeTopicLabel(initialSelectedField),
      ) ?? null
    );
  }, [folders, initialSelectedField]);

  const activeFieldId = activeFolder.fieldId?.trim() ?? "";
  const hasLoadedActiveSummary = activeFieldId ? Boolean(summaryReadyByField[activeFieldId]) : false;

  const logSummarySync = useCallback(
    (step: string, detail?: Record<string, unknown>) => {
      if (detail) {
        console.info(`[dashboard_sync] ${step}`, detail);
        return;
      }
      console.info(`[dashboard_sync] ${step}`);
    },
    [],
  );

  const refreshActiveSummary = useCallback(
    async (params: {
      folderId: string;
      fieldId: string;
      reason: "field_change" | "progress_sync" | "manual_retry";
      silent?: boolean;
    }) => {
      if (!params.folderId || !params.fieldId) {
        return;
      }

      if (inFlightSummaryFieldIdsRef.current.has(params.fieldId)) {
        logSummarySync("summary_fetch:skip_already_inflight", {
          folder_id: params.folderId,
          field_id: params.fieldId,
          reason: params.reason,
        });
        return;
      }

      const requestId = activeSummaryRequestIdRef.current + 1;
      activeSummaryRequestIdRef.current = requestId;
      const shouldShowBlockingLoader =
        !params.silent && !summaryReadyByFieldRef.current[params.fieldId];
      if (shouldShowBlockingLoader) {
        setIsLoadingActiveSummary(true);
      }
      setActiveSummaryError("");
      inFlightSummaryFieldIdsRef.current.add(params.fieldId);
      logSummarySync("summary_fetch:start", {
        request_id: requestId,
        folder_id: params.folderId,
        field_id: params.fieldId,
        reason: params.reason,
        silent: Boolean(params.silent),
        has_loaded_before: Boolean(summaryReadyByFieldRef.current[params.fieldId]),
      });

      try {
        try {
          const stepSeedResponse = await fetch(
            `/api/learning-steps/${encodeURIComponent(params.folderId)}`,
            {
              method: "GET",
              cache: "no-store",
            },
          );
          if (!stepSeedResponse.ok) {
            logSummarySync("summary_fetch:step_seed_non_blocking_error", {
              request_id: requestId,
              folder_id: params.folderId,
              status: stepSeedResponse.status,
            });
          }
        } catch (error) {
          logSummarySync("summary_fetch:step_seed_failed", {
            request_id: requestId,
            folder_id: params.folderId,
            reason: error instanceof Error ? error.message : String(error),
          });
        }

        const payload = await fetchJsonWithRequestDedupe<LearningSummaryApiResponse>({
          key: `dashboard:learning-summary:${params.fieldId}`,
          url: `/api/dashboard/learning-summary?field_id=${encodeURIComponent(params.fieldId)}`,
          init: {
            method: "GET",
            cache: "no-store",
          },
          ttlMs: 1500,
        });
        if (!payload.success || !payload.journey || !payload.field) {
          throw new Error(payload.message ?? "Unable to load learning summary right now.");
        }

        if (activeSummaryRequestIdRef.current !== requestId) {
          return;
        }

        const nextCurrentLevel = toDisplayLevel(payload.field.level, "Beginner");
        const nextTargetLevel = toDisplayLevel(payload.field.destination, "Intermediate");
        const totalSteps = Math.max(0, Math.round(payload.journey.total_steps));
        const completedSteps = Math.max(
          0,
          Math.min(totalSteps, Math.round(payload.journey.completed_steps)),
        );
        const currentStepIndex = Math.max(1, Math.round(payload.journey.current_step));
        const progress = Math.max(
          0,
          Math.min(100, Math.floor(payload.journey.progress_percent)),
        );

        logSummarySync("summary_fetch:success", {
          request_id: requestId,
          field_id: params.fieldId,
          journey_path_id: payload.journey.journey_path_id,
          total_steps: totalSteps,
          completed_steps: completedSteps,
          current_step: currentStepIndex,
          progress_percent: progress,
        });

        setFolders((previous) =>
          previous.map((folder) => {
            if (folder.id !== params.folderId) {
              return folder;
            }

            const nextFolder: LearningFolder = {
              ...folder,
              journeyPathId: payload.journey?.journey_path_id || folder.journeyPathId || null,
              name: payload.field?.title ?? folder.name,
              currentLevel: nextCurrentLevel,
              targetLevel: nextTargetLevel,
              totalSteps,
              completedSteps,
              progress,
              nextMilestone: buildNextMilestone({
                totalSteps,
                completedSteps,
                currentStepIndex,
                targetLevel: nextTargetLevel,
              }),
            };

            const unchanged =
              folder.journeyPathId === nextFolder.journeyPathId &&
              folder.name === nextFolder.name &&
              folder.currentLevel === nextFolder.currentLevel &&
              folder.targetLevel === nextFolder.targetLevel &&
              folder.totalSteps === nextFolder.totalSteps &&
              folder.completedSteps === nextFolder.completedSteps &&
              folder.progress === nextFolder.progress &&
              folder.nextMilestone === nextFolder.nextMilestone;
            if (unchanged) {
              return folder;
            }

            logSummarySync("summary_fetch:update_folder", {
              folder_id: folder.id,
              field_id: folder.fieldId ?? "",
              journey_path_id: nextFolder.journeyPathId ?? "",
              total_steps: nextFolder.totalSteps,
              completed_steps: nextFolder.completedSteps,
              progress: nextFolder.progress,
            });
            return {
              ...nextFolder,
            };
          }),
        );
        setSummaryReadyByField((previous) => {
          if (previous[params.fieldId]) {
            return previous;
          }
          const nextReady = {
            ...previous,
            [params.fieldId]: true,
          };
          summaryReadyByFieldRef.current = nextReady;
          return {
            ...nextReady,
          };
        });
      } catch (error) {
        if (activeSummaryRequestIdRef.current !== requestId) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unable to load learning summary right now.";
        setActiveSummaryError(message);
        logSummarySync("summary_fetch:error", {
          request_id: requestId,
          field_id: params.fieldId,
          reason: params.reason,
          message,
        });
      } finally {
        if (activeSummaryRequestIdRef.current === requestId) {
          if (shouldShowBlockingLoader) {
            setIsLoadingActiveSummary(false);
          }
        }
        inFlightSummaryFieldIdsRef.current.delete(params.fieldId);
      }
    },
    [logSummarySync],
  );

  useEffect(() => {
    if (!hasFolders || !activeFolderId || !activeFieldId) {
      setIsLoadingActiveSummary(false);
      setActiveSummaryError("");
      return;
    }

    void refreshActiveSummary({
      folderId: activeFolderId,
      fieldId: activeFieldId,
      reason: "field_change",
    });
  }, [activeFieldId, activeFolderId, hasFolders, refreshActiveSummary]);

  function openAddFieldModal() {
    setAddFieldError("");
    setIsAddFieldModalOpen(true);
  }

  function closeAddFieldModal() {
    if (isAddingField) {
      return;
    }
    setIsAddFieldModalOpen(false);
  }

  function openDeleteFieldModal(folder: LearningFolder) {
    setDeleteFieldTarget(folder);
    setDeleteFieldError("");
    setIsDeleteFieldModalOpen(true);
  }

  function closeDeleteFieldModal() {
    if (isDeletingField) {
      return;
    }
    setIsDeleteFieldModalOpen(false);
    setDeleteFieldTarget(null);
    setDeleteFieldError("");
  }

  function handleSelectFolder(folderId: string) {
    setActiveSummaryError("");
    setActiveFolderId(folderId);
    setActiveView("field");
  }

  function handleSelectStudyRoom(roomId: string) {
    setActiveStudyRoomId(roomId);
    setActiveView("study_rooms");
  }

  const handlePathProgressChange = useCallback(
    (update: {
      fieldEntryId: string;
      totalSteps: number;
      currentStepIndex: number;
      completedSteps: number;
      progress: number;
      origin?: "initial_load" | "mutation";
    }) => {
      setFolders((previous) =>
        previous.map((folder) => {
          if (folder.id !== update.fieldEntryId) {
            return folder;
          }

          const totalSteps = Math.max(0, Math.round(update.totalSteps));
          const completedSteps = Math.max(
            0,
            Math.min(totalSteps, Math.round(update.completedSteps)),
          );
          const progress = Math.max(0, Math.min(100, Math.round(update.progress)));

          return {
            ...folder,
            totalSteps,
            completedSteps,
            progress,
            nextMilestone: buildNextMilestone({
              totalSteps,
              completedSteps,
              currentStepIndex: Math.round(update.currentStepIndex),
              targetLevel: folder.targetLevel,
            }),
          };
        }),
      );

      if (update.origin !== "mutation") {
        return;
      }

      if (update.fieldEntryId === activeFolderId && activeFieldId) {
        void refreshActiveSummary({
          folderId: update.fieldEntryId,
          fieldId: activeFieldId,
          reason: "progress_sync",
          silent: true,
        });
      }
    },
    [activeFieldId, activeFolderId, refreshActiveSummary],
  );

  async function handleAddField(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validateAddField(addFieldValues);
    if (validationError) {
      setAddFieldError(validationError);
      return;
    }

    setIsAddingField(true);
    setAddFieldError("");

    try {
      const response = await fetch("/api/user/learning-fields", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: addFieldValues.learningGoal.trim(),
          current_level: addFieldValues.currentLevel,
          target_level: addFieldValues.targetLevel,
        }),
      });

      const payload = (await response.json()) as CreateLearningFieldApiResponse;
      if (!response.ok || !payload.success) {
        setAddFieldError(payload.message ?? "Unable to add this learning field right now.");
        setIsAddingField(false);
        return;
      }
      console.info("[dashboard] add_field_generation_result", {
        generation_source: payload.generation?.source ?? "unknown",
        generated: payload.generation?.generated ?? false,
        returned_step_count: payload.learning_steps?.length ?? 0,
      });

      const createdId =
        payload.learning_field && typeof payload.learning_field.id === "string"
          ? payload.learning_field.id
          : undefined;

      setIsAddFieldModalOpen(false);
      setAddFieldValues({
        learningGoal: "",
        currentLevel: "",
        targetLevel: "",
      });
      dashboardRequestCache.delete("dashboard:learning-fields");

      await loadLearningFields({
        forceActiveFolderId: createdId,
      });
      router.refresh();
    } catch {
      setAddFieldError("Unable to add this learning field right now.");
    } finally {
      setIsAddingField(false);
    }
  }

  async function handleDeleteField() {
    if (!deleteFieldTarget) {
      return;
    }

    setIsDeletingField(true);
    setDeleteFieldError("");

    try {
      const response = await fetch(
        `/api/user/learning-fields/${encodeURIComponent(deleteFieldTarget.id)}`,
        {
          method: "DELETE",
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as DeleteLearningFieldApiResponse;
      if (!response.ok || !payload.success) {
        setDeleteFieldError(payload.message ?? "Unable to delete this learning field right now.");
        return;
      }

      const remainingFolders = folders.filter((folder) => folder.id !== deleteFieldTarget.id);
      setFolders(remainingFolders);
      dashboardRequestCache.delete("dashboard:learning-fields");
      if (deleteFieldTarget.fieldId) {
        dashboardRequestCache.delete(`dashboard:learning-summary:${deleteFieldTarget.fieldId}`);
      }

      if (deleteFieldTarget.fieldId) {
        setSummaryReadyByField((previous) => {
          const next = { ...previous };
          delete next[deleteFieldTarget.fieldId as string];
          summaryReadyByFieldRef.current = next;
          return next;
        });
      }

      const nextFolderId =
        activeFolderId === deleteFieldTarget.id ? (remainingFolders[0]?.id ?? "") : activeFolderId;
      setActiveFolderId(nextFolderId);
      if (!nextFolderId) {
        setActiveView("field");
        setIsLoadingActiveSummary(false);
        setActiveSummaryError("");
      }

      setIsDeleteFieldModalOpen(false);
      setDeleteFieldTarget(null);
      setDeleteFieldError("");

      await loadLearningFields({
        forceActiveFolderId: nextFolderId || undefined,
      });
      router.refresh();
    } catch {
      setDeleteFieldError("Unable to delete this learning field right now.");
    } finally {
      setIsDeletingField(false);
    }
  }

  function renderMainPanel() {
    if (!hasFolders && activeView === "field") {
      return (
        <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
          <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
            Learning Fields
          </p>
          <h2 className="mt-4 text-3xl font-extrabold text-[#1F2937]">
            Add your first learning field.
          </h2>
          <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
            Choose what you want to learn, set your current level, and start your learning path.
          </p>
          <button
            type="button"
            onClick={openAddFieldModal}
            className="btn-3d btn-3d-green mt-5 inline-flex h-11 items-center justify-center px-6 text-base"
          >
            Add Learning Field
          </button>
        </section>
      );
    }

    if (activeView === "field" && isLoadingActiveSummary && !hasLoadedActiveSummary) {
      return (
        <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
          <div className="h-5 w-40 rounded-full bg-[#1F2937]/10" />
          <div className="mt-4 h-8 w-64 rounded-full bg-[#1F2937]/10" />
          <div className="mt-3 h-4 w-56 rounded-full bg-[#1F2937]/10" />
          <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-5 text-sm font-semibold text-[#1F2937]/70">
            Loading learning summary...
          </div>
        </section>
      );
    }

    if (activeView === "field" && activeSummaryError) {
      return (
        <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
          <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
            {activeSummaryError}
          </p>
          <button
            type="button"
            onClick={() => {
              if (!activeFolder.id || !activeFieldId) {
                return;
              }
              void refreshActiveSummary({
                folderId: activeFolder.id,
                fieldId: activeFieldId,
                reason: "manual_retry",
              });
            }}
            className="btn-3d btn-3d-white mt-4 inline-flex h-10 items-center justify-center px-5 !text-sm"
          >
            Retry
          </button>
        </section>
      );
    }

    if (activeView === "profile") {
      return <ProfilePanel folder={activeFolder} />;
    }
    if (activeView === "notes") {
      return <NotebookPanel folderName={activeFolder.name} />;
    }
    if (activeView === "friends") {
      return <FriendsPanel onMessagesUpdated={loadMessagesUnreadCount} />;
    }
    if (activeView === "messages") {
      return (
        <MessagesPanel
          onInboxUpdated={loadMessagesUnreadCount}
          onOpenStudyRoom={(roomId) => {
            setActiveView("study_rooms");
            setActiveStudyRoomId(roomId);
            void loadStudyRooms();
          }}
        />
      );
    }
    if (activeView === "study_rooms") {
      return (
        <>
          {studyRoomsError ? (
            <p className="mb-3 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
              {studyRoomsError}
            </p>
          ) : null}
          <StudyRoomsPanel
            rooms={studyRooms}
            activeRoomId={activeStudyRoomId}
            onSelectRoom={setActiveStudyRoomId}
            onRoomsUpdated={loadStudyRooms}
          />
        </>
      );
    }
    if (activeView === "more") {
      return (
        <MorePanel
          soundEffects={soundEffectsEnabled}
          animations={animationsEnabled}
          themeMode={themeMode}
          isSettingsLoading={isSettingsLoading}
          isSettingsSaving={isSettingsSaving}
          settingsMessage={settingsMessage}
          settingsError={settingsError}
          onToggleSoundEffects={handleToggleSoundEffects}
          onToggleAnimations={handleToggleAnimations}
          onSetThemeMode={handleSetThemeMode}
        />
      );
    }
    return (
      <LearningFieldPanel
        folder={activeFolder}
        onPathProgressChange={handlePathProgressChange}
      />
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-[1220px] px-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/55">
            Dashboard / {resolveBreadcrumbLabel(activeView, activeFolder)}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold text-[#1F2937] sm:text-4xl">
            Welcome back to Pathly
          </h1>
          <p className="mt-2 text-base font-semibold text-[#1F2937]/70">
            Your path continues here.
          </p>
          {selectedFromQuery ? (
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/60">
              Destination selected: {selectedFromQuery.name}
            </p>
          ) : null}
          {foldersError ? (
            <p className="mt-1 text-sm font-semibold text-[#c62828]">{foldersError}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border-2 border-[#1F2937]/12 bg-white px-4 py-3 shadow-sm">
          <svg
            viewBox="0 0 240 56"
            className="h-10 w-44"
            role="img"
            aria-label="Mini roadmap decoration"
          >
            <path d="M10 44 C42 18 94 14 130 30 C168 46 204 40 230 18" stroke="#FFF2A8" strokeWidth="20" strokeLinecap="round" fill="none" />
            <path d="M12 44 C44 20 94 18 130 32 C168 48 204 42 228 22" stroke="#F3CF22" strokeWidth="3.3" strokeLinecap="round" strokeDasharray="7 9" fill="none" />
            <rect x="72" y="5" width="7" height="18" rx="2.5" fill="#58CC02" />
            <polygon points="79,5 92,9 79,13" fill="#FFD84D" />
            <rect x="165" y="23" width="7" height="18" rx="2.5" fill="#58CC02" />
            <polygon points="172,23 185,27 172,31" fill="#FFD84D" />
          </svg>
        </div>
      </div>

      {hasFolders ? (
        <div className="mt-6">
          <DashboardSummaryCards
            folder={activeFolder}
            isLoading={activeView === "field" && isLoadingActiveSummary}
          />
        </div>
      ) : isLoadingFolders ? (
        <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-white px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
          Loading your learning fields...
        </div>
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-28">
          <DashboardSidebar
            folders={folders}
            activeFolderId={activeFolder.id}
            activeView={activeView}
            onSelectFolder={handleSelectFolder}
            onRequestDeleteFolder={openDeleteFieldModal}
            onSelectView={setActiveView}
            onSelectStudyRoom={handleSelectStudyRoom}
            onOpenAddFieldModal={openAddFieldModal}
            messagesUnreadCount={messagesUnreadCount}
            friendsUnreadCount={friendsUnreadCount}
            loadingFolderId={activeView === "field" && isLoadingActiveSummary ? activeFolder.id : null}
            deletingFolderId={isDeletingField ? deleteFieldTarget?.id ?? null : null}
            studyRooms={studyRooms.map((room) => ({
              id: room.id,
              name: room.name,
              style: room.style,
              role: room.role,
              status: room.status,
            }))}
            activeStudyRoomId={activeStudyRoomId}
          />
        </div>

        <div
          key={`${activeView}:${
            activeView === "field"
              ? activeFolder.id
              : activeView === "study_rooms"
                ? activeStudyRoomId || "none"
                : "utility"
          }`}
          className="min-w-0 motion-panel-switch"
        >
          {renderMainPanel()}
        </div>
      </div>

      {isAddFieldModalOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-lg rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <h2 className="text-2xl font-extrabold text-[#1F2937]">Add Learning Field</h2>
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
              Add another learning destination to your dashboard folders.
            </p>

            <form className="mt-5 space-y-4" onSubmit={handleAddField}>
              <div>
                <label className="mb-2 block text-sm font-bold text-[#1F2937]">
                  What do you want to learn?
                </label>
                <input
                  type="search"
                  list="dashboard-learning-goals"
                  value={addFieldValues.learningGoal}
                  onChange={(event) =>
                    setAddFieldValues((previous) => ({
                      ...previous,
                      learningGoal: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
                  placeholder="Web Development, Machine Learning, IELTS, Product Design"
                />
                <datalist id="dashboard-learning-goals">
                  <option value="Web Development" />
                  <option value="Machine Learning" />
                  <option value="IELTS" />
                  <option value="Product Design" />
                </datalist>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold text-[#1F2937]">
                    Current Level
                  </label>
                  <select
                    value={addFieldValues.currentLevel}
                    onChange={(event) =>
                      setAddFieldValues((previous) => ({
                        ...previous,
                        currentLevel: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
                  >
                    <option value="">Select level</option>
                    <option value="Beginner">Beginner</option>
                    <option value="Basic">Basic</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-[#1F2937]">
                    Target Level
                  </label>
                  <select
                    value={addFieldValues.targetLevel}
                    onChange={(event) =>
                      setAddFieldValues((previous) => ({
                        ...previous,
                        targetLevel: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
                  >
                    <option value="">Select level</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                    <option value="Expert">Expert</option>
                  </select>
                </div>
              </div>

              {addFieldError ? (
                <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                  {addFieldError}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeAddFieldModal}
                  disabled={isAddingField}
                  className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAddingField}
                  className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isAddingField ? "Adding..." : "Add Field"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isDeleteFieldModalOpen && deleteFieldTarget ? (
        <div className="fixed inset-0 z-[71] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-md rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <h2 className="text-2xl font-extrabold text-[#1F2937]">Delete learning field?</h2>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">
              This will remove this learning field and your related progress from your dashboard.
              Shared course templates may remain available for future reuse.
            </p>
            <p className="mt-3 rounded-xl bg-[#F6FCFF] px-3 py-2 text-sm font-bold text-[#1F2937]">
              {deleteFieldTarget.name}
            </p>

            {deleteFieldError ? (
              <p className="mt-3 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {deleteFieldError}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeDeleteFieldModal}
                disabled={isDeletingField}
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteField();
                }}
                disabled={isDeletingField}
                className="btn-3d inline-flex h-11 items-center justify-center border-[#A22020] bg-[#E53935] px-6 text-white shadow-[0_4px_0_#7f1d1d] transition hover:-translate-y-0.5 hover:bg-[#d93431] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isDeletingField ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


