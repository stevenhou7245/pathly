"use client";

import { mapStudyRoomRealtimeMessage } from "@/lib/chatRealtime";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type StudyRoomListItem = {
  id: string;
  room_id: string;
  name: string;
  style: string;
  status: string;
  max_participants: number;
  duration_minutes: number;
  created_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  role: string;
  joined_at: string | null;
  creator_id: string;
  password: string;
};

type StudyRoomDetail = {
  id: string;
  creator_id: string;
  name: string;
  style: string;
  max_participants: number;
  duration_minutes: number;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  password: string;
  can_close: boolean;
  can_extend: boolean;
  can_leave: boolean;
  viewer_user_id: string;
};

type StudyRoomParticipant = {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string | null;
  left_at: string | null;
  role: string;
  username: string;
  presence_state: "online" | "idle" | "focus" | "offline";
  focus_mode: boolean;
  focus_started_at: string | null;
  last_active_at: string | null;
  current_streak_seconds: number;
  total_focus_seconds: number;
  session_seconds: number;
  goal_text: string | null;
  goal_status: "not_started" | "in_progress" | "completed";
};

type StudyRoomMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  sender_username?: string | null;
  body: string;
  created_at: string | null;
  type: string;
};

type StudyRoomNotesRecord = {
  id: string | null;
  room_id: string;
  content: string | null;
  updated_by: string | null;
  updated_by_username: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type StudyRoomNoteEntry = {
  id: string;
  room_id: string;
  author_user_id: string;
  author_username: string | null;
  content_md: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_deleted: boolean;
};

type StudyRoomSharedResource = {
  id: string;
  room_id: string;
  source_kind: "url" | "file";
  resource_type: "video" | "article" | "website" | "document" | "notes" | "other";
  title: string;
  url: string | null;
  file_name: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  added_by: string;
  added_by_username: string | null;
  created_at: string | null;
};

type StudyRoomAiTutorMessage = {
  id: string;
  room_id: string;
  sender_id: string | null;
  sender_username: string | null;
  sender_type: "user" | "ai" | "assistant" | "system";
  role: "user" | "assistant" | "system";
  message_kind?: "chat" | "question" | "answer" | "summary";
  provider?: string | null;
  model?: string | null;
  context_summary?: string | null;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string | null;
};

type FriendListItem = {
  friendship_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  current_learning_field_title: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  friendship_status: string;
};

type StudyRoomsPanelProps = {
  rooms: StudyRoomListItem[];
  activeRoomId: string;
  onSelectRoom: (roomId: string) => void;
  onRoomsUpdated: () => Promise<void> | void;
};

type StudyRoomDetailResponse = {
  success: boolean;
  message?: string;
  room?: StudyRoomDetail;
  participants?: StudyRoomParticipant[];
};

type StudyRoomMessagesResponse = {
  success: boolean;
  message?: string;
  messages?: StudyRoomMessage[];
  sent_message?: StudyRoomMessage;
};

type StudyRoomCreateResponse = {
  success: boolean;
  message?: string;
  room_id?: string;
};

type StudyRoomJoinResponse = {
  success: boolean;
  message?: string;
  room?: {
    id: string;
  };
};

type StudyRoomActionResponse = {
  success: boolean;
  message?: string;
  room?: {
    id: string;
    status: string;
    duration_minutes: number;
    expires_at: string | null;
  };
  invited_count?: number;
  room_id?: string;
};

type StudyRoomPresenceResponse = {
  success: boolean;
  message?: string;
  participants?: StudyRoomParticipant[];
  participant?: StudyRoomParticipant;
};

type StudyRoomGoalsResponse = {
  success: boolean;
  message?: string;
  participants?: StudyRoomParticipant[];
  participant?: StudyRoomParticipant;
};

type StudyRoomNotesResponse = {
  success: boolean;
  message?: string;
  note?: StudyRoomNotesRecord;
  entries?: StudyRoomNoteEntry[];
  my_entry?: StudyRoomNoteEntry | null;
  saved_entry?: StudyRoomNoteEntry;
};

type StudyRoomResourcesResponse = {
  success: boolean;
  message?: string;
  resources?: StudyRoomSharedResource[];
  resource?: StudyRoomSharedResource;
};

type StudyRoomAiTutorResponse = {
  success: boolean;
  message?: string;
  messages?: StudyRoomAiTutorMessage[];
  user_message?: StudyRoomAiTutorMessage;
  assistant_message?: StudyRoomAiTutorMessage;
};

type FriendsApiResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  friends?: FriendListItem[];
};

function appendStudyRoomMessageUnique(
  previous: StudyRoomMessage[],
  incoming: StudyRoomMessage,
) {
  if (previous.some((message) => message.id === incoming.id)) {
    return previous;
  }
  return [...previous, incoming].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Recently";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "Recently";
  }
  return timestamp.toLocaleString();
}

function formatShortDurationFromSeconds(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function formatBytes(value: number | null) {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) {
    return "Unknown size";
  }
  const bytes = Number(value);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function styleBadgeClass(style: string) {
  const normalized = style.trim().toLowerCase();
  if (normalized === "sprint") {
    return "bg-[#FFD84D] text-[#1F2937]";
  }
  if (normalized === "calm") {
    return "bg-[#DDF2FF] text-[#1F2937]";
  }
  if (normalized === "intense") {
    return "bg-[#FFD5D5] text-[#1F2937]";
  }
  return "bg-[#E9FFD8] text-[#1F2937]";
}

function presenceBadgeClass(state: StudyRoomParticipant["presence_state"]) {
  if (state === "focus") {
    return "bg-[#58CC02]/20 text-[#1F2937]";
  }
  if (state === "idle") {
    return "bg-[#FFD84D]/30 text-[#1F2937]";
  }
  if (state === "offline") {
    return "bg-[#E5E7EB] text-[#4B5563]";
  }
  return "bg-[#DDF2FF] text-[#1F2937]";
}

export default function StudyRoomsPanel({
  rooms,
  activeRoomId,
  onSelectRoom,
  onRoomsUpdated,
}: StudyRoomsPanelProps) {
  type WorkspaceSizePreset = 25 | 50 | 75 | 100 | "custom";
  const [panelError, setPanelError] = useState("");
  const [panelMessage, setPanelMessage] = useState("");

  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createStyle, setCreateStyle] = useState("focus");
  const [createDuration, setCreateDuration] = useState("60");
  const [createPassword, setCreatePassword] = useState("");

  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinPassword, setJoinPassword] = useState("");

  const [isLoadingRoom, setIsLoadingRoom] = useState(false);
  const [roomDetail, setRoomDetail] = useState<StudyRoomDetail | null>(null);
  const [participants, setParticipants] = useState<StudyRoomParticipant[]>([]);
  const [messages, setMessages] = useState<StudyRoomMessage[]>([]);

  const [messageDraft, setMessageDraft] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isLeavingRoom, setIsLeavingRoom] = useState(false);
  const [isClosingRoom, setIsClosingRoom] = useState(false);
  const [isExtendingRoom, setIsExtendingRoom] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"chat" | "notes" | "resources" | "ai">("chat");
  const [workspaceSizePreset, setWorkspaceSizePreset] = useState<WorkspaceSizePreset>(75);
  const [workspaceRect, setWorkspaceRect] = useState(() => ({
    x: 80,
    y: 56,
    width: 1180,
    height: 720,
  }));
  const [isDraggingWorkspace, setIsDraggingWorkspace] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const [resizeOrigin, setResizeOrigin] = useState({ x: 0, y: 0, width: 1180, height: 720 });
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 860,
  );
  const [notesRecord, setNotesRecord] = useState<StudyRoomNotesRecord | null>(null);
  const [noteEntries, setNoteEntries] = useState<StudyRoomNoteEntry[]>([]);
  const [myNoteEntryId, setMyNoteEntryId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [resources, setResources] = useState<StudyRoomSharedResource[]>([]);
  const [resourceComposerMode, setResourceComposerMode] = useState<"url" | "file">("url");
  const [newResourceType, setNewResourceType] = useState<
    "video" | "article" | "website" | "document" | "notes" | "other"
  >("website");
  const [newResourceTitle, setNewResourceTitle] = useState("");
  const [newResourceUrl, setNewResourceUrl] = useState<string>("");
  const [newResourceFile, setNewResourceFile] = useState<File | null>(null);
  const [isAddingResource, setIsAddingResource] = useState(false);
  const [isUploadingResourceFile, setIsUploadingResourceFile] = useState(false);
  const [aiMessages, setAiMessages] = useState<StudyRoomAiTutorMessage[]>([]);
  const [aiQuestionDraft, setAiQuestionDraft] = useState("");
  const [isAskingAiTutor, setIsAskingAiTutor] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalStatusDraft, setGoalStatusDraft] = useState<"not_started" | "in_progress" | "completed">(
    "not_started",
  );
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const lastInteractionAtRef = useRef(Date.now());
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteFriends, setInviteFriends] = useState<FriendListItem[]>([]);
  const [selectedInviteFriendIds, setSelectedInviteFriendIds] = useState<string[]>([]);
  const [isLoadingInviteFriends, setIsLoadingInviteFriends] = useState(false);
  const [isSendingInvites, setIsSendingInvites] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<
    "room_id" | "password" | "invite" | ""
  >("");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showExpireModal, setShowExpireModal] = useState(false);
  const [showExtendInput, setShowExtendInput] = useState(false);
  const [extendDurationInput, setExtendDurationInput] = useState("60");
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const resourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const previousMessageCountRef = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [activeRoomId, rooms],
  );
  const isMobileWorkspace = viewportWidth < 900;

  const workspacePresetOptions = [25, 50, 75, 100] as const;

  const computeWorkspaceRectForPreset = useCallback(
    (preset: 25 | 50 | 75 | 100) => {
      const desktopPaddingX = preset === 100 ? 12 : 24;
      const desktopPaddingY = preset === 100 ? 12 : 20;
      const maxWidth = Math.max(420, viewportWidth - desktopPaddingX * 2);
      const maxHeight = Math.max(420, viewportHeight - desktopPaddingY * 2);
      const ratioByPreset: Record<25 | 50 | 75 | 100, { w: number; h: number }> = {
        25: { w: 0.4, h: 0.45 },
        50: { w: 0.58, h: 0.62 },
        75: { w: 0.78, h: 0.8 },
        100: { w: 0.96, h: 0.94 },
      };
      const ratio = ratioByPreset[preset];
      const width = Math.max(420, Math.round(maxWidth * ratio.w));
      const height = Math.max(460, Math.round(maxHeight * ratio.h));
      const x = Math.max(desktopPaddingX, Math.round((viewportWidth - width) / 2));
      const y = Math.max(desktopPaddingY, Math.round((viewportHeight - height) / 2));
      return { x, y, width, height };
    },
    [viewportHeight, viewportWidth],
  );

  const applyWorkspacePreset = useCallback(
    (preset: 25 | 50 | 75 | 100) => {
      setWorkspaceSizePreset(preset);
      if (isMobileWorkspace) {
        return;
      }
      setWorkspaceRect(computeWorkspaceRectForPreset(preset));
    },
    [computeWorkspaceRectForPreset, isMobileWorkspace],
  );

  const timingInfo = useMemo(() => {
    if (!roomDetail) {
      return null;
    }
    const createdAt = roomDetail.created_at ? new Date(roomDetail.created_at) : null;
    const expiresAt = roomDetail.expires_at ? new Date(roomDetail.expires_at) : null;
    const createdAtMs = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null;
    const expiresAtMs = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.getTime() : null;
    const remainingSeconds =
      expiresAtMs !== null ? Math.max(0, Math.floor((expiresAtMs - countdownNowMs) / 1000)) : 0;

    return {
      createdAtText: formatTimestamp(roomDetail.created_at),
      originalDurationText: `${roomDetail.duration_minutes} minutes`,
      remainingSeconds,
      remainingText: formatShortDurationFromSeconds(remainingSeconds),
      statusText: roomDetail.status.replaceAll("_", " "),
      hasExpired: roomDetail.status === "expired" || remainingSeconds <= 0,
      createdAtMs,
      expiresAtMs,
    };
  }, [countdownNowMs, roomDetail]);

  const canSendMessages = roomDetail?.status === "active";
  const currentParticipant = useMemo(
    () =>
      roomDetail
        ? participants.find((participant) => participant.user_id === roomDetail.viewer_user_id) ?? null
        : null,
    [participants, roomDetail],
  );
  const sortedNoteEntries = useMemo(
    () =>
      [...noteEntries].sort((a, b) =>
        (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
      ),
    [noteEntries],
  );
  const myLatestNoteEntry = useMemo(() => {
    if (myNoteEntryId) {
      const byId = noteEntries.find((entry) => entry.id === myNoteEntryId);
      if (byId) {
        return byId;
      }
    }
    if (!roomDetail) {
      return null;
    }
    return (
      noteEntries.find((entry) => entry.author_user_id === roomDetail.viewer_user_id && !entry.is_deleted) ?? null
    );
  }, [myNoteEntryId, noteEntries, roomDetail]);

  function scrollMessagesToBottom() {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }

  function checkIsAtBottom() {
    const container = messagesContainerRef.current;
    if (!container) {
      return true;
    }
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 24;
  }

  const loadRoomData = useCallback(
    async (roomId: string) => {
      if (!roomId) {
        setRoomDetail(null);
        setParticipants([]);
        setMessages([]);
        return;
      }

      setIsLoadingRoom(true);
      setPanelError("");
      try {
        const [detailResponse, messagesResponse] = await Promise.all([
          fetch(`/api/study-room/${encodeURIComponent(roomId)}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/messages`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const detailPayload = (await detailResponse.json()) as StudyRoomDetailResponse;
        const messagesPayload = (await messagesResponse.json()) as StudyRoomMessagesResponse;

        if (!detailResponse.ok || !detailPayload.success || !detailPayload.room) {
          throw new Error(detailPayload.message ?? "Unable to load room details.");
        }
        if (!messagesResponse.ok || !messagesPayload.success) {
          throw new Error(messagesPayload.message ?? "Unable to load room messages.");
        }

        setRoomDetail(detailPayload.room);
        setParticipants(detailPayload.participants ?? []);
        setMessages((messagesPayload.messages ?? []).sort((a, b) =>
          (a.created_at ?? "").localeCompare(b.created_at ?? ""),
        ));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load room data.";
        setPanelError(message);
        setRoomDetail(null);
        setParticipants([]);
        setMessages([]);
      } finally {
        setIsLoadingRoom(false);
      }
    },
    [],
  );

  const loadWorkspaceExtras = useCallback(
    async (roomId: string) => {
      if (!roomId) {
        setNotesRecord(null);
        setNoteEntries([]);
        setMyNoteEntryId(null);
        setNotesDraft("");
        setResources([]);
        setAiMessages([]);
        return;
      }

      try {
        const [notesResponse, resourcesResponse, aiResponse, goalsResponse] = await Promise.all([
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/notes`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/resources`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/ai-tutor`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/goals`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const notesPayload = (await notesResponse.json()) as StudyRoomNotesResponse;
        const resourcesPayload = (await resourcesResponse.json()) as StudyRoomResourcesResponse;
        const aiPayload = (await aiResponse.json()) as StudyRoomAiTutorResponse;
        const goalsPayload = (await goalsResponse.json()) as StudyRoomGoalsResponse;

        if (notesResponse.ok && notesPayload.success) {
          setNotesRecord(notesPayload.note ?? null);
          const entries = notesPayload.entries ?? [];
          setNoteEntries(entries);
          const myEntry = notesPayload.my_entry ?? null;
          setMyNoteEntryId(myEntry?.id ?? null);
          setNotesDraft(myEntry?.content_md ?? "");
        } else {
          setNotesRecord(null);
          setNoteEntries([]);
          setMyNoteEntryId(null);
          setNotesDraft("");
        }
        if (resourcesResponse.ok && resourcesPayload.success) {
          setResources(resourcesPayload.resources ?? []);
        }
        if (aiResponse.ok && aiPayload.success) {
          setAiMessages(aiPayload.messages ?? []);
        }
        if (goalsResponse.ok && goalsPayload.success && goalsPayload.participants) {
          setParticipants(goalsPayload.participants);
        }
      } catch (error) {
        console.warn("[study_room_workspace] extras_load_failed", {
          room_id: roomId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) {
      onSelectRoom(rooms[0].id);
    }
  }, [activeRoomId, onSelectRoom, rooms]);

  useEffect(() => {
    if (!activeRoomId) {
      setRoomDetail(null);
      setParticipants([]);
      setMessages([]);
      return;
    }
    void loadRoomData(activeRoomId);
    void loadWorkspaceExtras(activeRoomId);
  }, [activeRoomId, loadRoomData, loadWorkspaceExtras]);

  useEffect(() => {
    if (!activeRoomId) {
      setIsWorkspaceOpen(false);
      return;
    }
    setWorkspaceSizePreset(75);
    setIsWorkspaceOpen(true);
  }, [activeRoomId]);

  useEffect(() => {
    if (!currentParticipant) {
      return;
    }
    setGoalDraft(currentParticipant.goal_text ?? "");
    setGoalStatusDraft(currentParticipant.goal_status);
    setFocusModeEnabled(currentParticipant.focus_mode || currentParticipant.presence_state === "focus");
  }, [currentParticipant]);

  useEffect(() => {
    const handler = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    handler();
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("resize", handler);
    };
  }, []);

  useEffect(() => {
    if (!isWorkspaceOpen || isMobileWorkspace) {
      return;
    }
    if (workspaceSizePreset === "custom") {
      return;
    }
    setWorkspaceRect(computeWorkspaceRectForPreset(workspaceSizePreset));
  }, [
    computeWorkspaceRectForPreset,
    isMobileWorkspace,
    isWorkspaceOpen,
    viewportHeight,
    viewportWidth,
    workspaceSizePreset,
  ]);

  useEffect(() => {
    previousMessageCountRef.current = 0;
    setNewMessagesCount(0);
    setIsAtBottom(true);
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
    });
  }, [activeRoomId]);

  useEffect(() => {
    if (!roomDetail?.id) {
      return;
    }
    const timer = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [roomDetail?.id]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopyFeedback("");
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copyFeedback]);

  useEffect(() => {
    if (!isWorkspaceOpen || !roomDetail) {
      return;
    }
    const markActive = () => {
      lastInteractionAtRef.current = Date.now();
    };
    window.addEventListener("mousemove", markActive);
    window.addEventListener("keydown", markActive);
    window.addEventListener("click", markActive);
    return () => {
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("click", markActive);
    };
  }, [isWorkspaceOpen, roomDetail]);

  useEffect(() => {
    if (!roomDetail || !isWorkspaceOpen) {
      return;
    }
    const tick = window.setInterval(() => {
      const inactiveForMs = Date.now() - lastInteractionAtRef.current;
      const presenceState =
        focusModeEnabled ? "focus" : inactiveForMs > 90_000 ? "idle" : "online";
      void fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/presence`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          presence_state: presenceState,
          focus_mode: focusModeEnabled,
        }),
      }).catch(() => {
        // best-effort heartbeat
      });
    }, 20_000);
    return () => {
      window.clearInterval(tick);
    };
  }, [focusModeEnabled, isWorkspaceOpen, roomDetail]);

  useEffect(() => {
    if (!isWorkspaceOpen || !roomDetail || isMobileWorkspace) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      if (isDraggingWorkspace) {
        setWorkspaceRect((previous) => ({
          ...previous,
          x: Math.max(8, Math.min(viewportWidth - previous.width - 8, event.clientX - dragOffset.x)),
          y: Math.max(8, Math.min(viewportHeight - previous.height - 8, event.clientY - dragOffset.y)),
        }));
      }
      if (isResizingWorkspace) {
        const nextWidth = Math.max(
          860,
          Math.min(viewportWidth - 16, resizeOrigin.width + (event.clientX - resizeOrigin.x)),
        );
        const nextHeight = Math.max(
          560,
          Math.min(viewportHeight - 16, resizeOrigin.height + (event.clientY - resizeOrigin.y)),
        );
        setWorkspaceRect((previous) => ({
          ...previous,
          width: nextWidth,
          height: nextHeight,
        }));
      }
    };

    const onMouseUp = () => {
      setIsDraggingWorkspace(false);
      setIsResizingWorkspace(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    dragOffset.x,
    dragOffset.y,
    isDraggingWorkspace,
    isMobileWorkspace,
    isResizingWorkspace,
    isWorkspaceOpen,
    resizeOrigin.height,
    resizeOrigin.width,
    resizeOrigin.x,
    resizeOrigin.y,
    roomDetail,
    viewportHeight,
    viewportWidth,
  ]);

  useEffect(() => {
    if (!roomDetail || !timingInfo) {
      setShowExpireModal(false);
      setShowExtendInput(false);
      return;
    }
    if (timingInfo.hasExpired && roomDetail.status !== "closed") {
      setShowExpireModal(true);
      console.info("[study_room] duration_expired_notice", {
        room_id: roomDetail.id,
        status: roomDetail.status,
        viewer_user_id: roomDetail.viewer_user_id,
        creator_id: roomDetail.creator_id,
      });
    } else {
      setShowExpireModal(false);
      setShowExtendInput(false);
    }
  }, [roomDetail, timingInfo]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    const hasNewMessages = messages.length > previousCount;

    if (hasNewMessages) {
      if (isAtBottom) {
        requestAnimationFrame(() => {
          scrollMessagesToBottom();
        });
        setNewMessagesCount(0);
      } else {
        setNewMessagesCount((count) => count + (messages.length - previousCount));
      }
    }

    previousMessageCountRef.current = messages.length;
  }, [isAtBottom, messages]);

  useEffect(() => {
    if (!activeRoomId) {
      return;
    }

    let active = true;
    let supabaseClient: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try {
      supabaseClient = getSupabaseBrowserClient();
    } catch (error) {
      console.warn("[study_room_realtime] client_init_failed", {
        room_id: activeRoomId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const channel = supabaseClient
      .channel(`study-room:${activeRoomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "study_room_messages",
          filter: `room_id=eq.${activeRoomId}`,
        },
        (payload) => {
          if (!active) {
            return;
          }
          const mapped = mapStudyRoomRealtimeMessage(payload.new);
          if (!mapped.id || mapped.room_id !== activeRoomId) {
            return;
          }

          const senderIsParticipant =
            participants.length === 0 || participants.some((row) => row.user_id === mapped.sender_id);
          if (!senderIsParticipant) {
            console.warn("[study_room_realtime] unauthorized_sender_ignored", {
              room_id: activeRoomId,
              sender_id: mapped.sender_id,
            });
            return;
          }

          console.info("[study_room_realtime] message_received", {
            room_id: mapped.room_id,
            sender_id: mapped.sender_id,
            message_id: mapped.id,
            type: mapped.type,
          });

          setMessages((previous) =>
            appendStudyRoomMessageUnique(previous, {
              id: mapped.id,
              room_id: mapped.room_id,
              sender_id: mapped.sender_id,
              body: mapped.body,
              created_at: mapped.created_at,
              type: mapped.type,
            }),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "study_room_participants",
          filter: `room_id=eq.${activeRoomId}`,
        },
        () => {
          console.info("[study_room_realtime] participants_changed", {
            room_id: activeRoomId,
          });
          void loadRoomData(activeRoomId);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "study_room_note_entries",
          filter: `room_id=eq.${activeRoomId}`,
        },
        () => {
          void loadWorkspaceExtras(activeRoomId);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "study_room_resources",
          filter: `room_id=eq.${activeRoomId}`,
        },
        () => {
          void loadWorkspaceExtras(activeRoomId);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "study_room_ai_messages",
          filter: `room_id=eq.${activeRoomId}`,
        },
        () => {
          void loadWorkspaceExtras(activeRoomId);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "study_rooms",
          filter: `id=eq.${activeRoomId}`,
        },
        () => {
          console.info("[study_room_realtime] room_state_changed", {
            room_id: activeRoomId,
          });
          void loadRoomData(activeRoomId);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.info("[study_room_realtime] subscription_succeeded", {
            room_id: activeRoomId,
          });
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[study_room_realtime] subscription_failed", {
            room_id: activeRoomId,
            status,
          });
        }
      });

    return () => {
      active = false;
      console.info("[study_room_realtime] subscription_cleanup", {
        room_id: activeRoomId,
      });
      void channel.unsubscribe();
      if (supabaseClient) {
        void supabaseClient.removeChannel(channel);
      }
    };
  }, [activeRoomId, loadRoomData, loadWorkspaceExtras, participants]);

  async function handleCreateRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPanelError("");
    setPanelMessage("");

    const name = createName.trim();
    const password = createPassword.trim();
    const duration = Math.max(15, Math.min(720, Number(createDuration) || 60));

    if (!name) {
      setPanelError("Room name is required.");
      return;
    }
    if (!password) {
      setPanelError("Password is required.");
      return;
    }

    setIsCreatingRoom(true);
    try {
      const response = await fetch("/api/study-room/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          style: createStyle,
          duration_minutes: duration,
          password,
        }),
      });
      const payload = (await response.json()) as StudyRoomCreateResponse;
      if (!response.ok || !payload.success || !payload.room_id) {
        throw new Error(payload.message ?? "Unable to create study room.");
      }

      await onRoomsUpdated();
      onSelectRoom(payload.room_id);
      setCreateName("");
      setCreatePassword("");
      setCreateDuration("60");
      setPanelMessage("Study room created.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create study room.";
      setPanelError(message);
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function handleJoinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPanelError("");
    setPanelMessage("");

    const roomId = joinRoomId.trim();
    const password = joinPassword.trim();
    if (!roomId || !password) {
      setPanelError("Room ID and password are required.");
      return;
    }

    setIsJoiningRoom(true);
    try {
      const response = await fetch("/api/study-room/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: roomId,
          password,
        }),
      });
      const payload = (await response.json()) as StudyRoomJoinResponse;
      if (!response.ok || !payload.success || !payload.room?.id) {
        throw new Error(payload.message ?? "Unable to join study room.");
      }

      await onRoomsUpdated();
      onSelectRoom(payload.room.id);
      setJoinRoomId("");
      setJoinPassword("");
      setPanelMessage("Joined study room.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to join study room.";
      setPanelError(message);
    } finally {
      setIsJoiningRoom(false);
    }
  }

  async function handleSendMessage() {
    if (!activeRoomId) {
      return;
    }
    if (!canSendMessages) {
      setPanelError("This room is not active. Messaging is disabled.");
      return;
    }
    const text = messageDraft.trim();
    if (!text) {
      return;
    }

    setIsSendingMessage(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(activeRoomId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: text,
          type: "chat",
        }),
      });
      const payload = (await response.json()) as StudyRoomMessagesResponse;
      if (!response.ok || !payload.success || !payload.sent_message) {
        throw new Error(payload.message ?? "Unable to send room message.");
      }

      console.info("[study_room_realtime] message_sent", {
        room_id: activeRoomId,
        message_id: payload.sent_message.id,
      });

      setMessages((previous) =>
        appendStudyRoomMessageUnique(previous, payload.sent_message as StudyRoomMessage),
      );
      setMessageDraft("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send room message.";
      console.error("[study_room_realtime] send_failed", {
        room_id: activeRoomId,
        reason: message,
      });
      setPanelError(message);
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleCopyValue(mode: "room_id" | "password" | "invite", value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore clipboard permission errors in unsupported contexts
    }
    setCopyFeedback(mode);
  }

  async function handleOpenInviteModal() {
    if (!roomDetail?.can_close) {
      return;
    }
    setIsInviteModalOpen(true);
    setPanelError("");
    setIsLoadingInviteFriends(true);
    setSelectedInviteFriendIds([]);
    try {
      const response = await fetch("/api/friends", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as FriendsApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load friends list.");
      }
      const nextFriends = (payload.friends ?? []).filter(
        (friend) => friend.friendship_status === "accepted",
      );
      setInviteFriends(nextFriends);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load friends list.";
      setPanelError(message);
      setInviteFriends([]);
    } finally {
      setIsLoadingInviteFriends(false);
    }
  }

  async function handleSendInvites() {
    if (!roomDetail) {
      return;
    }
    if (selectedInviteFriendIds.length === 0) {
      setPanelError("Please select at least one friend to invite.");
      return;
    }
    setIsSendingInvites(true);
    setPanelError("");
    try {
      console.info("[study_room_invite] sending", {
        room_id: roomDetail.id,
        selected_count: selectedInviteFriendIds.length,
      });
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friend_user_ids: selectedInviteFriendIds,
        }),
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to send invitations.");
      }
      setPanelMessage(
        payload.message ?? `Invitations sent to ${payload.invited_count ?? selectedInviteFriendIds.length} friends.`,
      );
      setIsInviteModalOpen(false);
      setSelectedInviteFriendIds([]);
      setInviteFriends([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send invitations.";
      setPanelError(message);
    } finally {
      setIsSendingInvites(false);
    }
  }

  async function handleExtendRoom() {
    if (!roomDetail) {
      return;
    }
    const durationMinutes = Math.max(15, Math.min(720, Number(extendDurationInput) || 60));
    setIsExtendingRoom(true);
    setPanelError("");
    try {
      console.info("[study_room] extension_started", {
        room_id: roomDetail.id,
        duration_minutes: durationMinutes,
      });
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/extend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          duration_minutes: durationMinutes,
        }),
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to extend room.");
      }
      setPanelMessage("Room duration updated.");
      setShowExtendInput(false);
      setShowExpireModal(false);
      await onRoomsUpdated();
      await loadRoomData(roomDetail.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to extend room.";
      setPanelError(message);
    } finally {
      setIsExtendingRoom(false);
    }
  }

  async function handleLeaveRoom() {
    if (!activeRoomId) {
      return;
    }
    setIsLeavingRoom(true);
    setPanelError("");
    setPanelMessage("");
    try {
      const response = await fetch("/api/study-room/leave", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: activeRoomId,
        }),
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to leave room.");
      }

      await onRoomsUpdated();
      setPanelMessage(payload.message ?? "Left room.");
      const nextRoom = rooms.find((room) => room.id !== activeRoomId);
      onSelectRoom(nextRoom?.id ?? "");
      setIsWorkspaceOpen(Boolean(nextRoom?.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to leave room.";
      setPanelError(message);
    } finally {
      setIsLeavingRoom(false);
      setShowLeaveConfirm(false);
    }
  }

  async function handleCloseRoom() {
    if (!activeRoomId) {
      return;
    }
    setIsClosingRoom(true);
    setPanelError("");
    setPanelMessage("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(activeRoomId)}/close`, {
        method: "POST",
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to close room.");
      }

      await onRoomsUpdated();
      setPanelMessage("Study room closed.");
      const nextRoom = rooms.find((room) => room.id !== activeRoomId);
      onSelectRoom(nextRoom?.id ?? "");
      setIsWorkspaceOpen(Boolean(nextRoom?.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to close room.";
      setPanelError(message);
    } finally {
      setIsClosingRoom(false);
      setShowCloseConfirm(false);
    }
  }

  async function handleToggleFocusMode() {
    if (!roomDetail) {
      return;
    }
    const nextFocus = !focusModeEnabled;
    setFocusModeEnabled(nextFocus);
    lastInteractionAtRef.current = Date.now();
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/presence`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          presence_state: nextFocus ? "focus" : "online",
          focus_mode: nextFocus,
        }),
      });
      const payload = (await response.json()) as StudyRoomPresenceResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to update focus mode.");
      }
      await loadRoomData(roomDetail.id);
    } catch (error) {
      setFocusModeEnabled(!nextFocus);
      const message = error instanceof Error ? error.message : "Unable to update focus mode.";
      setPanelError(message);
    }
  }

  async function handleSaveGoal() {
    if (!roomDetail) {
      return;
    }
    setIsSavingGoal(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/goals`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          goal_text: goalDraft.trim() ? goalDraft.trim() : null,
          goal_status: goalStatusDraft,
        }),
      });
      const payload = (await response.json()) as StudyRoomGoalsResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to save goal.");
      }
      await loadRoomData(roomDetail.id);
      setPanelMessage("Goal updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save goal.";
      setPanelError(message);
    } finally {
      setIsSavingGoal(false);
    }
  }

  async function handleSaveNotes() {
    if (!roomDetail) {
      return;
    }
    setIsSavingNotes(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/notes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: notesDraft,
          entry_id: myNoteEntryId,
        }),
      });
      const payload = (await response.json()) as StudyRoomNotesResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to save notes.");
      }
      setNotesRecord(payload.note ?? null);
      setNoteEntries(payload.entries ?? []);
      setMyNoteEntryId(payload.my_entry?.id ?? payload.saved_entry?.id ?? null);
      setNotesDraft((payload.my_entry?.content_md ?? payload.saved_entry?.content_md ?? notesDraft) ?? "");
      setPanelMessage("Your notes were saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save notes.";
      setPanelError(message);
    } finally {
      setIsSavingNotes(false);
    }
  }

  async function handleDeleteNoteEntry(entryId: string) {
    if (!roomDetail) {
      return;
    }
    setPanelError("");
    try {
      const response = await fetch(
        `/api/study-room/${encodeURIComponent(roomDetail.id)}/notes?entry_id=${encodeURIComponent(entryId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json()) as StudyRoomNotesResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to delete note.");
      }
      setNotesRecord(payload.note ?? null);
      setNoteEntries(payload.entries ?? []);
      setMyNoteEntryId(payload.my_entry?.id ?? null);
      if (!payload.my_entry || payload.my_entry.id === entryId) {
        setNotesDraft(payload.my_entry?.content_md ?? "");
      }
      setPanelMessage("Note removed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete note.";
      setPanelError(message);
    }
  }

  async function handleAddResource() {
    if (!roomDetail) {
      return;
    }
    setIsAddingResource(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/resources`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_kind: "url",
          resource_type: newResourceType,
          title: newResourceTitle,
          url: newResourceUrl,
        }),
      });
      const payload = (await response.json()) as StudyRoomResourcesResponse;
      if (!response.ok || !payload.success || !payload.resource) {
        throw new Error(payload.message ?? "Unable to add resource.");
      }
      setResources((previous) => [payload.resource as StudyRoomSharedResource, ...previous]);
      setNewResourceTitle("");
      setNewResourceUrl("");
      setPanelMessage("Link resource added.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add resource.";
      setPanelError(message);
    } finally {
      setIsAddingResource(false);
    }
  }

  async function handleUploadResourceFile() {
    if (!roomDetail || !newResourceFile) {
      return;
    }

    setIsUploadingResourceFile(true);
    setPanelError("");
    try {
      const formData = new FormData();
      formData.set("title", newResourceTitle);
      formData.set("resource_type", newResourceType);
      formData.set("file", newResourceFile);

      const response = await fetch(
        `/api/study-room/${encodeURIComponent(roomDetail.id)}/resources/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      const payload = (await response.json()) as StudyRoomResourcesResponse;
      if (!response.ok || !payload.success || !payload.resource) {
        throw new Error(payload.message ?? "Unable to upload file resource.");
      }
      setResources((previous) => [payload.resource as StudyRoomSharedResource, ...previous]);
      setNewResourceTitle("");
      setNewResourceFile(null);
      if (resourceFileInputRef.current) {
        resourceFileInputRef.current.value = "";
      }
      setPanelMessage("File uploaded and shared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to upload file resource.";
      setPanelError(message);
    } finally {
      setIsUploadingResourceFile(false);
    }
  }

  async function handleRemoveResource(resourceId: string) {
    if (!roomDetail) {
      return;
    }
    try {
      const response = await fetch(
        `/api/study-room/${encodeURIComponent(roomDetail.id)}/resources/${encodeURIComponent(resourceId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json()) as { success: boolean; message?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to remove resource.");
      }
      setResources((previous) => previous.filter((resource) => resource.id !== resourceId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove resource.";
      setPanelError(message);
    }
  }

  async function handleAskAiTutor() {
    if (!roomDetail) {
      return;
    }
    const question = aiQuestionDraft.trim();
    if (!question) {
      return;
    }
    setIsAskingAiTutor(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/ai-tutor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          include_in_notes: true,
        }),
      });
      const payload = (await response.json()) as StudyRoomAiTutorResponse;
      if (
        !response.ok ||
        !payload.success ||
        !payload.user_message ||
        !payload.assistant_message
      ) {
        throw new Error(payload.message ?? "Unable to ask AI tutor.");
      }
      setAiMessages((previous) => [
        ...previous,
        payload.user_message as StudyRoomAiTutorMessage,
        payload.assistant_message as StudyRoomAiTutorMessage,
      ]);
      setAiQuestionDraft("");
      void loadWorkspaceExtras(roomDetail.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to ask AI tutor.";
      setPanelError(message);
    } finally {
      setIsAskingAiTutor(false);
    }
  }

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-extrabold text-[#1F2937]">Study Rooms</h2>
          <p className="text-sm font-semibold text-[#1F2937]/70">
            Multi-user room chat with shared focus sessions.
          </p>
        </div>
      </div>

      {panelError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {panelError}
        </p>
      ) : null}
      {panelMessage ? (
        <p className="mt-4 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
          {panelMessage}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <form
          onSubmit={(event) => {
            void handleCreateRoom(event);
          }}
          className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4"
        >
          <p className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Create Room
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Room name"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <select
              value={createStyle}
              onChange={(event) => setCreateStyle(event.target.value)}
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            >
              <option value="focus">focus</option>
              <option value="sprint">sprint</option>
              <option value="calm">calm</option>
              <option value="intense">intense</option>
            </select>
            <input
              type="number"
              min={15}
              max={720}
              value={createDuration}
              onChange={(event) => setCreateDuration(event.target.value)}
              placeholder="Duration (minutes)"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <input
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
              placeholder="Room password"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
          </div>
          <button
            type="submit"
            disabled={isCreatingRoom}
            className="btn-3d btn-3d-green mt-4 inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isCreatingRoom ? "Creating..." : "Create Room"}
          </button>
        </form>

        <form
          onSubmit={(event) => {
            void handleJoinRoom(event);
          }}
          className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#FFF9DD] p-4"
        >
          <p className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Join Room
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={joinRoomId}
              onChange={(event) => setJoinRoomId(event.target.value)}
              placeholder="Room ID"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <input
              value={joinPassword}
              onChange={(event) => setJoinPassword(event.target.value)}
              placeholder="Password"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
          </div>
          <button
            type="submit"
            disabled={isJoiningRoom}
            className="btn-3d btn-3d-white mt-4 inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isJoiningRoom ? "Joining..." : "Join Room"}
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Active Room
          </p>
          {selectedRoom ? (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${styleBadgeClass(selectedRoom.style)}`}
            >
              {selectedRoom.style}
            </span>
          ) : null}
        </div>

        {!selectedRoom ? (
          <p className="mt-3 text-sm font-semibold text-[#1F2937]/70">
            No active room selected. Create or join one to start.
          </p>
        ) : isLoadingRoom ? (
          <p className="mt-3 text-sm font-semibold text-[#1F2937]/70">Loading room...</p>
        ) : roomDetail ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1F2937]/10 bg-[#F8FCFF] px-4 py-3">
            <div>
              <p className="text-base font-extrabold text-[#1F2937]">{roomDetail.name}</p>
              <p className="text-xs font-semibold text-[#1F2937]/65">
                {participants.length} participant(s) · status: {roomDetail.status}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsWorkspaceOpen(true)}
              className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm"
            >
              Open Workspace
            </button>
          </div>
        ) : null}
      </div>

      {isWorkspaceOpen && roomDetail ? (
        <div className="fixed inset-0 z-[90] bg-black/35 backdrop-blur-[1px]">
          <div
            className="absolute inset-0"
            onClick={() => {
              setIsWorkspaceOpen(false);
            }}
          />
          <section
            className={`absolute z-[91] overflow-hidden rounded-[1.4rem] border-2 border-[#1F2937] bg-white shadow-[0_8px_0_#1F2937,0_22px_34px_rgba(31,41,55,0.22)] ${
              isMobileWorkspace ? "inset-0 rounded-none border-0 shadow-none" : ""
            }`}
            style={
              isMobileWorkspace
                ? undefined
                : {
                    left: workspaceRect.x,
                    top: workspaceRect.y,
                    width: workspaceRect.width,
                    height: workspaceRect.height,
                  }
            }
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3">
              <div
                className={`min-w-0 ${isMobileWorkspace ? "" : "cursor-move"}`}
                onMouseDown={(event) => {
                  if (isMobileWorkspace || workspaceSizePreset === 100) {
                    return;
                  }
                  setIsDraggingWorkspace(true);
                  setDragOffset({
                    x: event.clientX - workspaceRect.x,
                    y: event.clientY - workspaceRect.y,
                  });
                }}
              >
                <p className="truncate text-base font-extrabold text-[#1F2937]">{roomDetail.name}</p>
                <p className="text-xs font-semibold text-[#1F2937]/65">
                  Room ID: {roomDetail.id} · status: {roomDetail.status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyValue("room_id", roomDetail.id);
                  }}
                  className="rounded-full border border-[#1F2937]/20 bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                >
                  {copyFeedback === "room_id" ? "Copied" : "Copy ID"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyValue("password", roomDetail.password);
                  }}
                  className="rounded-full border border-[#1F2937]/20 bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                >
                  {copyFeedback === "password" ? "Copied" : "Copy Password"}
                </button>
                {roomDetail.can_close ? (
                  <button
                    type="button"
                    onClick={() => {
                      void handleOpenInviteModal();
                    }}
                    className="rounded-full border border-[#1F2937]/20 bg-[#FFF9DD] px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                  >
                    Invite
                  </button>
                ) : null}
                <div
                  className="flex items-center gap-1 rounded-full border border-[#1F2937]/20 bg-white px-2 py-1"
                  onWheel={(event) => {
                    if (isMobileWorkspace) {
                      return;
                    }
                    if (!(event.ctrlKey || event.altKey)) {
                      return;
                    }
                    event.preventDefault();
                    const currentPreset =
                      workspaceSizePreset === "custom" ? 75 : workspaceSizePreset;
                    const currentIndex = workspacePresetOptions.indexOf(currentPreset);
                    const direction = event.deltaY < 0 ? 1 : -1;
                    const nextIndex = Math.max(
                      0,
                      Math.min(workspacePresetOptions.length - 1, currentIndex + direction),
                    );
                    const nextPreset = workspacePresetOptions[nextIndex];
                    applyWorkspacePreset(nextPreset);
                  }}
                >
                  <span className="px-1 text-[11px] font-extrabold text-[#1F2937]/70">Size</span>
                  <select
                    value={workspaceSizePreset === "custom" ? "custom" : String(workspaceSizePreset)}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "custom") {
                        setWorkspaceSizePreset("custom");
                        return;
                      }
                      const preset = Number(value) as 25 | 50 | 75 | 100;
                      applyWorkspacePreset(preset);
                    }}
                    className="rounded-full border border-[#1F2937]/15 bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#1F2937] outline-none"
                    title="Hold Ctrl or Alt and use mouse wheel here to resize quickly."
                    disabled={isMobileWorkspace}
                  >
                    {workspacePresetOptions.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}%
                      </option>
                    ))}
                    {workspaceSizePreset === "custom" ? <option value="custom">Custom</option> : null}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkspaceOpen(false);
                  }}
                  className="rounded-full border border-[#1F2937]/20 bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid h-[calc(100%-56px)] gap-0 lg:grid-cols-[1.8fr_1fr]">
              <div className="flex min-h-0 flex-col border-r border-[#1F2937]/10">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#1F2937]/10 px-4 py-2">
                  {(["chat", "notes", "resources", "ai"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setWorkspaceTab(tab)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${
                        workspaceTab === tab
                          ? "border-[#1F2937] bg-[#58CC02] text-white"
                          : "border-[#1F2937]/15 bg-white text-[#1F2937]"
                      }`}
                    >
                      {tab === "ai" ? "AI Tutor" : tab}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleFocusMode();
                    }}
                    className={`ml-auto rounded-full border px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${
                      focusModeEnabled
                        ? "border-[#1F2937] bg-[#58CC02]/20 text-[#1F2937]"
                        : "border-[#1F2937]/15 bg-white text-[#1F2937]"
                    }`}
                  >
                    {focusModeEnabled ? "Focus On" : "Focus Off"}
                  </button>
                </div>

                <div className="min-h-0 flex-1 p-4">
                  {workspaceTab === "chat" ? (
                    <div className="flex h-full flex-col">
                      <div
                        ref={messagesContainerRef}
                        onScroll={() => {
                          const atBottom = checkIsAtBottom();
                          setIsAtBottom(atBottom);
                          if (atBottom) {
                            setNewMessagesCount(0);
                          }
                        }}
                        className="flex-1 overflow-y-auto rounded-xl border-2 border-[#1F2937]/10 bg-[#F9FCFF] p-3"
                      >
                        {messages.length === 0 ? (
                          <p className="my-10 text-center text-sm font-semibold text-[#1F2937]/65">
                            No room messages yet.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {messages.map((message) => {
                              const isMine = message.sender_id === roomDetail.viewer_user_id;
                              const fallbackName =
                                participants.find((participant) => participant.user_id === message.sender_id)?.username ??
                                "Unknown";
                              const senderName = message.sender_username ?? fallbackName;
                              return (
                                <div
                                  key={message.id}
                                  className={`rounded-xl border px-3 py-2 ${
                                    isMine
                                      ? "border-[#58CC02]/40 bg-[#E9FFD8]"
                                      : "border-[#1F2937]/12 bg-white"
                                  }`}
                                >
                                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                                    {senderName}
                                  </p>
                                  <p className="text-sm font-semibold text-[#1F2937]">{message.body}</p>
                                  <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/55">
                                    {formatTimestamp(message.created_at)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {newMessagesCount > 0 && !isAtBottom ? (
                        <div className="mt-2 flex justify-center">
                          <button
                            type="button"
                            onClick={() => {
                              scrollMessagesToBottom();
                              setIsAtBottom(true);
                              setNewMessagesCount(0);
                            }}
                            className="rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] px-4 py-1.5 text-xs font-extrabold text-[#1F2937]"
                          >
                            New messages ({newMessagesCount})
                          </button>
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={messageDraft}
                          onChange={(event) => setMessageDraft(event.target.value)}
                          placeholder="Send a room message..."
                          disabled={!canSendMessages}
                          className="w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleSendMessage();
                          }}
                          disabled={isSendingMessage || !canSendMessages}
                          className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isSendingMessage ? "Sending..." : "Send"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {workspaceTab === "notes" ? (
                    <div className="flex h-full flex-col gap-3">
                      <div className="rounded-xl border border-[#1F2937]/12 bg-[#F7FFE9] p-3">
                        <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                          Your Notes
                        </p>
                        <textarea
                          value={notesDraft}
                          onChange={(event) => setNotesDraft(event.target.value)}
                          placeholder="Write your own markdown notes here..."
                          className="mt-2 min-h-[160px] w-full resize-none rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-[#1F2937]/65">
                          <p>
                            {myLatestNoteEntry
                              ? `Your latest update · ${formatTimestamp(
                                  myLatestNoteEntry.updated_at ?? myLatestNoteEntry.created_at,
                                )}`
                              : "No personal note saved yet."}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              void handleSaveNotes();
                            }}
                            disabled={isSavingNotes}
                            className="btn-3d btn-3d-green inline-flex h-9 items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {isSavingNotes ? "Saving..." : "Save My Note"}
                          </button>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                        <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                          Room Notes Feed
                        </p>
                        {sortedNoteEntries.length === 0 ? (
                          notesRecord?.content ? (
                            <div className="rounded-xl border border-[#1F2937]/12 bg-white p-3">
                              <p className="text-xs font-extrabold text-[#1F2937]/65">Legacy Shared Note</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-[#1F2937]">
                                {notesRecord.content}
                              </p>
                              <p className="mt-2 text-[11px] font-semibold text-[#1F2937]/55">
                                Updated by {notesRecord.updated_by_username ?? "Unknown"} ·{" "}
                                {formatTimestamp(notesRecord.updated_at)}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm font-semibold text-[#1F2937]/65">
                              No room notes yet. Add your first note.
                            </p>
                          )
                        ) : (
                          <div className="space-y-2">
                            {sortedNoteEntries.map((entry) => {
                              const isMine = roomDetail.viewer_user_id === entry.author_user_id;
                              return (
                                <div
                                  key={entry.id}
                                  className={`rounded-xl border p-3 ${
                                    isMine
                                      ? "border-[#58CC02]/35 bg-[#EEFFE3]"
                                      : "border-[#1F2937]/12 bg-white"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-extrabold text-[#1F2937]/75">
                                        {entry.author_username ?? "Unknown"}
                                        {isMine ? " (You)" : ""}
                                      </p>
                                      <p className="text-[11px] font-semibold text-[#1F2937]/55">
                                        {formatTimestamp(entry.updated_at ?? entry.created_at)}
                                      </p>
                                    </div>
                                    {isMine ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void handleDeleteNoteEntry(entry.id);
                                        }}
                                        className="rounded-full border border-[#1F2937]/20 bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#1F2937]"
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </div>
                                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-[#1F2937]">
                                    {entry.content_md?.trim() ? entry.content_md : "(empty note)"}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {workspaceTab === "resources" ? (
                    <div className="flex h-full flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setResourceComposerMode("url");
                            setNewResourceUrl((previous) => previous ?? "");
                          }}
                          className={`rounded-full border px-3 py-1 text-xs font-extrabold ${
                            resourceComposerMode === "url"
                              ? "border-[#58CC02] bg-[#E9FFD8] text-[#1F2937]"
                              : "border-[#1F2937]/20 bg-white text-[#1F2937]/70"
                          }`}
                        >
                          Add Link
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResourceComposerMode("file");
                            setNewResourceUrl((previous) => previous ?? "");
                          }}
                          className={`rounded-full border px-3 py-1 text-xs font-extrabold ${
                            resourceComposerMode === "file"
                              ? "border-[#58CC02] bg-[#E9FFD8] text-[#1F2937]"
                              : "border-[#1F2937]/20 bg-white text-[#1F2937]/70"
                          }`}
                        >
                          Upload File
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <select
                          value={newResourceType}
                          onChange={(event) =>
                            setNewResourceType(
                              event.target.value as
                                | "video"
                                | "article"
                                | "website"
                                | "document"
                                | "notes"
                                | "other",
                            )
                          }
                          className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        >
                          <option value="video">Video</option>
                          <option value="article">Article</option>
                          <option value="website">Website</option>
                          <option value="document">Document</option>
                          <option value="notes">Notes</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          value={newResourceTitle}
                          onChange={(event) => setNewResourceTitle(event.target.value)}
                          placeholder="Resource title"
                          className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        {resourceComposerMode === "url" ? (
                          <input
                            value={newResourceUrl ?? ""}
                            onChange={(event) => setNewResourceUrl(event.target.value)}
                            placeholder="https://..."
                            className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                          />
                        ) : (
                          <div className="flex items-center gap-2 rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2">
                            <input
                              ref={resourceFileInputRef}
                              type="file"
                              accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp"
                              onChange={(event) => {
                                const selectedFile = event.target.files?.[0] ?? null;
                                setNewResourceFile(selectedFile);
                                if (!newResourceTitle.trim() && selectedFile?.name) {
                                  setNewResourceTitle(selectedFile.name.replace(/\.[^.]+$/, ""));
                                }
                              }}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => resourceFileInputRef.current?.click()}
                              className="rounded-full border border-[#1F2937]/20 bg-[#E9FFD8] px-3 py-1 text-xs font-extrabold text-[#1F2937]"
                            >
                              Choose File
                            </button>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#1F2937]/70">
                              {newResourceFile?.name ?? "No file selected"}
                            </span>
                          </div>
                        )}
                      </div>
                      {resourceComposerMode === "url" ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handleAddResource();
                          }}
                          disabled={isAddingResource}
                          className="btn-3d btn-3d-green inline-flex h-9 w-fit items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isAddingResource ? "Adding..." : "Add Link"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            void handleUploadResourceFile();
                          }}
                          disabled={isUploadingResourceFile || !newResourceFile}
                          className="btn-3d btn-3d-green inline-flex h-9 w-fit items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isUploadingResourceFile ? "Uploading..." : "Upload File"}
                        </button>
                      )}
                      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                        {resources.length === 0 ? (
                          <p className="text-sm font-semibold text-[#1F2937]/65">No shared resources yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {resources.map((resource) => (
                              <div key={resource.id} className="rounded-xl border border-[#1F2937]/12 bg-white p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-extrabold text-[#1F2937]">{resource.title}</p>
                                    <p className="text-xs font-semibold text-[#1F2937]/60">
                                      {resource.resource_type.toUpperCase()} ·{" "}
                                      {resource.source_kind.toUpperCase()} · by{" "}
                                      {resource.added_by_username ?? "Unknown"} · {formatTimestamp(resource.created_at)}
                                    </p>
                                    {resource.source_kind === "file" ? (
                                      <p className="text-[11px] font-semibold text-[#1F2937]/55">
                                        {resource.file_name ?? "uploaded file"} · {formatBytes(resource.file_size_bytes)}
                                      </p>
                                    ) : null}
                                  </div>
                                  {roomDetail.viewer_user_id === resource.added_by ||
                                  roomDetail.can_close ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleRemoveResource(resource.id);
                                      }}
                                      className="rounded-full border border-[#1F2937]/20 bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#1F2937]"
                                    >
                                      Remove
                                    </button>
                                  ) : null}
                                </div>
                                {resource.url ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <a
                                      href={resource.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center justify-center rounded-full border border-[#0B66C3]/35 bg-[#EFF7FF] px-3 py-1 text-xs font-extrabold text-[#0B66C3]"
                                    >
                                      {resource.source_kind === "file" ? "Open / Download" : "Open Link"}
                                    </a>
                                    <span className="text-[11px] font-semibold text-[#1F2937]/50 break-all">
                                      {resource.url}
                                    </span>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs font-semibold text-[#1F2937]/50">
                                    Resource URL unavailable.
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {workspaceTab === "ai" ? (
                    <div className="flex h-full flex-col">
                      <div className="flex-1 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                        {aiMessages.length === 0 ? (
                          <p className="text-sm font-semibold text-[#1F2937]/65">
                            Ask AI Tutor for help on this room&apos;s topic and shared resources.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {aiMessages.map((message) => (
                              <div
                                key={message.id}
                                className={`rounded-xl border px-3 py-2 ${
                                  message.role === "assistant"
                                    ? "border-[#58CC02]/40 bg-[#E9FFD8]"
                                    : "border-[#1F2937]/12 bg-white"
                                }`}
                              >
                                <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                                  {message.role === "assistant"
                                    ? "AI Tutor"
                                    : message.sender_username ?? "You"}
                                </p>
                                <p className="text-sm font-semibold whitespace-pre-wrap text-[#1F2937]">
                                  {message.body}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/55">
                                  {formatTimestamp(message.created_at)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <textarea
                          value={aiQuestionDraft}
                          onChange={(event) => setAiQuestionDraft(event.target.value)}
                          placeholder="Ask AI Tutor..."
                          className="min-h-[44px] w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleAskAiTutor();
                          }}
                          disabled={isAskingAiTutor}
                          className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isAskingAiTutor ? "Asking..." : "Ask"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <aside className="min-h-0 overflow-y-auto bg-[#FFFDF3] p-4">
                <div className="rounded-2xl border border-[#1F2937]/12 bg-white p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                    My Goal
                  </p>
                  <textarea
                    value={goalDraft}
                    onChange={(event) => setGoalDraft(event.target.value)}
                    placeholder="Set your goal..."
                    className="mt-2 min-h-[72px] w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={goalStatusDraft}
                      onChange={(event) =>
                        setGoalStatusDraft(
                          event.target.value as "not_started" | "in_progress" | "completed",
                        )
                      }
                      className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                    >
                      <option value="not_started">not_started</option>
                      <option value="in_progress">in_progress</option>
                      <option value="completed">completed</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSaveGoal();
                      }}
                      disabled={isSavingGoal}
                      className="btn-3d btn-3d-green inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSavingGoal ? "Saving..." : "Save Goal"}
                    </button>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-[#1F2937]/12 bg-white p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                    Participants
                  </p>
                  <div className="mt-2 space-y-2">
                    {participants.map((participant) => (
                      <div key={participant.id} className="rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-extrabold text-[#1F2937]">{participant.username}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${presenceBadgeClass(participant.presence_state)}`}>
                            {participant.presence_state}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/60">
                          {participant.role === "creator" ? "creator" : "participant"} · session{" "}
                          {formatShortDurationFromSeconds(participant.session_seconds)} · streak{" "}
                          {formatShortDurationFromSeconds(participant.current_streak_seconds)}
                        </p>
                        {participant.goal_text ? (
                          <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/75">
                            Goal ({participant.goal_status}): {participant.goal_text}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-[#1F2937]/12 bg-white p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                    Room Duration
                  </p>
                  <div className="mt-2 space-y-1 text-xs font-semibold text-[#1F2937]/72">
                    <p>Created: {timingInfo?.createdAtText ?? "Unknown"}</p>
                    <p>Duration: {timingInfo?.originalDurationText ?? "-"}</p>
                    <p>Remaining: {timingInfo?.remainingText ?? "-"}</p>
                    <p>Status: {timingInfo?.statusText ?? "-"}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {roomDetail.can_close ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowCloseConfirm(true)}
                          disabled={isClosingRoom}
                          className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isClosingRoom ? "Closing..." : "Close Room"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowExtendInput(true);
                            setShowExpireModal(true);
                          }}
                          disabled={isExtendingRoom}
                          className="btn-3d btn-3d-green inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Extend
                        </button>
                      </>
                    ) : roomDetail.can_leave ? (
                      <button
                        type="button"
                        onClick={() => setShowLeaveConfirm(true)}
                        disabled={isLeavingRoom}
                        className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isLeavingRoom ? "Leaving..." : "Leave Room"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </aside>
            </div>

            {!isMobileWorkspace && workspaceSizePreset !== 100 ? (
              <button
                type="button"
                aria-label="Resize workspace"
                onMouseDown={(event) => {
                  setIsResizingWorkspace(true);
                  setWorkspaceSizePreset("custom");
                  setResizeOrigin({
                    x: event.clientX,
                    y: event.clientY,
                    width: workspaceRect.width,
                    height: workspaceRect.height,
                  });
                }}
                className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-tl-lg border-l border-t border-[#1F2937]/20 bg-[#FFF9DD]"
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {showCloseConfirm && roomDetail ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-md rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <p className="text-xl font-extrabold text-[#1F2937]">Close this room early?</p>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
              Are you sure you want to close this study room now? All participants will be removed from the active session.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCloseRoom();
                }}
                disabled={isClosingRoom}
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isClosingRoom ? "Closing..." : "Confirm Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showLeaveConfirm && roomDetail ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-md rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <p className="text-xl font-extrabold text-[#1F2937]">Leave room?</p>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
              Are you sure you want to leave this study room?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleLeaveRoom();
                }}
                disabled={isLeavingRoom}
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLeavingRoom ? "Leaving..." : "Confirm Leave"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showExpireModal && roomDetail ? (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-lg rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <p className="text-xl font-extrabold text-[#1F2937]">Room time is over</p>
            {roomDetail.can_extend ? (
              <>
                <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
                  Your study room has reached its scheduled end time.
                </p>
                {showExtendInput ? (
                  <div className="mt-3 rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3">
                    <label className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                      New duration (minutes)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={720}
                      value={extendDurationInput}
                      onChange={(event) => setExtendDurationInput(event.target.value)}
                      className="mt-2 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                    />
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {!showExtendInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleCloseRoom();
                      }}
                      disabled={isClosingRoom}
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isClosingRoom ? "Closing..." : "Close Room"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (showExtendInput) {
                        void handleExtendRoom();
                        return;
                      }
                      setShowExtendInput(true);
                    }}
                    disabled={isExtendingRoom}
                    className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isExtendingRoom ? "Extending..." : showExtendInput ? "Confirm Extension" : "Continue Room"}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
                This room has expired and is waiting for the creator’s action. You can review messages, but sending is disabled.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {isInviteModalOpen && roomDetail ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-2xl rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xl font-extrabold text-[#1F2937]">Invite Friends</p>
                <p className="text-sm font-semibold text-[#1F2937]/70">
                  Select friends to invite into {roomDetail.name}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="rounded-full border border-[#1F2937]/20 bg-white px-3 py-1 text-xs font-extrabold text-[#1F2937]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3">
              {isLoadingInviteFriends ? (
                <p className="text-sm font-semibold text-[#1F2937]/70">Loading friends...</p>
              ) : inviteFriends.length === 0 ? (
                <p className="text-sm font-semibold text-[#1F2937]/70">No eligible friends found.</p>
              ) : (
                <div className="space-y-2">
                  {inviteFriends.map((friend) => (
                    <label
                      key={friend.user_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[#1F2937]/12 bg-white px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-extrabold text-[#1F2937]">{friend.username}</p>
                        <p className="text-[11px] font-semibold text-[#1F2937]/60">
                          {friend.current_learning_field_title ?? "No active field"}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedInviteFriendIds.includes(friend.user_id)}
                        onChange={(event) => {
                          setSelectedInviteFriendIds((previous) => {
                            if (event.target.checked) {
                              return Array.from(new Set([...previous, friend.user_id]));
                            }
                            return previous.filter((id) => id !== friend.user_id);
                          });
                        }}
                        className="h-4 w-4 accent-[#58CC02]"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSendInvites();
                }}
                disabled={isSendingInvites || selectedInviteFriendIds.length === 0}
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSendingInvites ? "Sending..." : "Send Invitations"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

