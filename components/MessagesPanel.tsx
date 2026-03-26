"use client";

import AvatarPreviewModal from "@/components/AvatarPreviewModal";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { playSound } from "@/lib/sound";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type MessagesPanelProps = {
  onInboxUpdated?: () => void;
  onOpenStudyRoom?: (roomId: string) => void;
};

type FriendRequestItem = {
  friendship_id: string;
  sender: {
    id: string;
    username: string;
    avatar_url: string | null;
    current_learning_field_title: string | null;
  };
  status: string;
  created_at: string | null;
};

type SystemMessageItem = {
  user_message_id: string;
  system_message_id: string;
  title: string;
  body: string;
  created_at: string | null;
  is_read: boolean;
};

type FriendRequestsApiResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  friend_requests?: FriendRequestItem[];
};

type SystemMessagesApiResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  current_user_role?: string | null;
  system_messages?: SystemMessageItem[];
};

type RespondFriendRequestApiResponse = {
  success: boolean;
  message?: string;
};

type MarkSystemMessageReadApiResponse = {
  success: boolean;
  message?: string;
};

type StudyInvitationItem = {
  id: string;
  room_id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  created_at: string | null;
  responded_at: string | null;
  sender_username: string;
  room_name: string;
  room_password: string;
  room_style: string;
  room_duration_minutes: number;
  room_status: string;
  room_expires_at: string | null;
};

type StudyInvitationsApiResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  study_invitations?: StudyInvitationItem[];
};

type RespondStudyInvitationApiResponse = {
  success: boolean;
  message?: string;
  room_id?: string;
};

type MessagesTab = "friend_requests" | "official_messages" | "study_invitations";

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

function toInitial(username: string) {
  return username.trim().charAt(0).toUpperCase() || "M";
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function parseReadBy(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return Array.from(
    new Set(
      value
        .map((item) => toStringValue(item).trim())
        .filter(Boolean),
    ),
  );
}

function sortByCreatedAtDesc<T extends { created_at: string | null }>(items: T[]) {
  return [...items].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const next = items.filter((existing) => existing.id !== item.id);
  next.push(item);
  return next;
}

function toRealtimeLogDetails(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  let serialized = "";
  try {
    serialized = JSON.stringify(error);
  } catch {
    serialized = "[unserializable]";
  }
  return {
    error,
    error_message: message,
    error_serialized: serialized,
  };
}

export default function MessagesPanel({ onInboxUpdated, onOpenStudyRoom }: MessagesPanelProps) {
  const [activeTab, setActiveTab] = useState<MessagesTab>("friend_requests");
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([]);
  const [friendRequestsLoaded, setFriendRequestsLoaded] = useState(false);
  const [systemMessages, setSystemMessages] = useState<SystemMessageItem[]>([]);
  const [studyInvitations, setStudyInvitations] = useState<StudyInvitationItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [panelError, setPanelError] = useState("");
  const [respondingRequestId, setRespondingRequestId] = useState("");
  const [markingReadId, setMarkingReadId] = useState("");
  const [respondingInvitationId, setRespondingInvitationId] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<{
    avatarUrl: string | null;
    fallbackInitial: string;
    displayName: string;
  } | null>(null);
  const didHydrateRealtimeRef = useRef(false);
  const knownOfficialMessageIdsRef = useRef<Set<string>>(new Set());
  const knownStudyInvitationIdsRef = useRef<Set<string>>(new Set());
  const knownIncomingFriendshipIdsRef = useRef<Set<string>>(new Set());
  const currentUserIdRef = useRef("");
  const currentUserRoleRef = useRef<string | null>(null);
  const onInboxUpdatedRef = useRef(onInboxUpdated);

  const loadInboxData = useCallback(async () => {
    setIsLoading(true);
    setPanelError("");
    setFriendRequestsLoaded(false);

    try {
      const [friendResult, systemResult, studyInvitationsResult] = await Promise.allSettled([
        fetch("/api/messages/friend-requests", {
          method: "GET",
          cache: "no-store",
        }),
        fetch("/api/messages/system", {
          method: "GET",
          cache: "no-store",
        }),
        fetch("/api/messages/study-invitations", {
          method: "GET",
          cache: "no-store",
        }),
      ]);

      const sectionErrors: string[] = [];

      let resolvedCurrentUserId = "";
      let resolvedCurrentUserRole: string | null = null;
      let nextFriendRequests: FriendRequestItem[] = [];
      let nextSystemMessages: SystemMessageItem[] = [];
      let nextStudyInvitations: StudyInvitationItem[] = [];

      if (friendResult.status === "fulfilled") {
        const friendResponse = friendResult.value;
        const friendPayload = (await friendResponse.json()) as FriendRequestsApiResponse;
        if (friendResponse.ok && friendPayload.success && Array.isArray(friendPayload.friend_requests)) {
          resolvedCurrentUserId = friendPayload.current_user_id?.trim() ?? resolvedCurrentUserId;
          nextFriendRequests = sortByCreatedAtDesc(friendPayload.friend_requests);
        } else {
          sectionErrors.push(friendPayload.message ?? "Unable to load friend requests.");
        }
      } else {
        sectionErrors.push("Unable to load friend requests.");
      }

      if (systemResult.status === "fulfilled") {
        const systemResponse = systemResult.value;
        const systemPayload = (await systemResponse.json()) as SystemMessagesApiResponse;
        if (systemResponse.ok && systemPayload.success) {
          resolvedCurrentUserId = systemPayload.current_user_id?.trim() ?? resolvedCurrentUserId;
          resolvedCurrentUserRole = systemPayload.current_user_role?.trim() || null;
          nextSystemMessages = sortByCreatedAtDesc(systemPayload.system_messages ?? []);
        } else {
          sectionErrors.push(systemPayload.message ?? "Unable to load official messages.");
        }
      } else {
        sectionErrors.push("Unable to load official messages.");
      }

      if (studyInvitationsResult.status === "fulfilled") {
        const invitationsResponse = studyInvitationsResult.value;
        const invitationsPayload = (await invitationsResponse.json()) as StudyInvitationsApiResponse;
        if (invitationsResponse.ok && invitationsPayload.success) {
          resolvedCurrentUserId = invitationsPayload.current_user_id?.trim() ?? resolvedCurrentUserId;
          nextStudyInvitations = sortByCreatedAtDesc(invitationsPayload.study_invitations ?? []);
        } else {
          sectionErrors.push(
            invitationsPayload.message ?? "Unable to load study room invitations.",
          );
        }
      } else {
        sectionErrors.push("Unable to load study room invitations.");
      }

      setCurrentUserId(resolvedCurrentUserId);
      setCurrentUserRole(resolvedCurrentUserRole);
      setFriendRequests(nextFriendRequests);
      setFriendRequestsLoaded(true);
      setSystemMessages(nextSystemMessages);
      setStudyInvitations(nextStudyInvitations);

      knownIncomingFriendshipIdsRef.current = new Set(
        nextFriendRequests.map((item) => item.friendship_id).filter(Boolean),
      );
      knownOfficialMessageIdsRef.current = new Set(
        nextSystemMessages.map((item) => item.system_message_id).filter(Boolean),
      );
      knownStudyInvitationIdsRef.current = new Set(
        nextStudyInvitations.map((item) => item.id).filter(Boolean),
      );
      didHydrateRealtimeRef.current = true;

      if (sectionErrors.length > 0) {
        setPanelError(sectionErrors.join(" "));
      }

      onInboxUpdated?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load inbox right now.";
      setPanelError(message);
    } finally {
      setIsLoading(false);
    }
  }, [onInboxUpdated]);

  useEffect(() => {
    void loadInboxData();
  }, [loadInboxData]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    currentUserRoleRef.current = currentUserRole;
  }, [currentUserRole]);

  useEffect(() => {
    onInboxUpdatedRef.current = onInboxUpdated;
  }, [onInboxUpdated]);

  const refreshStudyInvitationsFromServer = useCallback(
    async (reason: string) => {
      try {
        const response = await fetch("/api/messages/study-invitations", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json()) as StudyInvitationsApiResponse;
        if (!response.ok || !payload.success) {
          console.warn("[messages_realtime] study_invitations_refresh_failed", {
            reason,
            status: response.status,
            message: payload.message ?? "Unable to refresh study invitations.",
          });
          return;
        }

        const nextStudyInvitations = sortByCreatedAtDesc(payload.study_invitations ?? []);
        const nextUserId = payload.current_user_id?.trim() ?? "";
        if (nextUserId && nextUserId !== currentUserIdRef.current) {
          setCurrentUserId(nextUserId);
        }
        setStudyInvitations(nextStudyInvitations);
        knownStudyInvitationIdsRef.current = new Set(
          nextStudyInvitations.map((item) => item.id).filter(Boolean),
        );

        console.info("[messages_realtime] study_invitations_refreshed", {
          reason,
          current_user_id: currentUserIdRef.current,
          count: nextStudyInvitations.length,
        });
        onInboxUpdatedRef.current?.();
      } catch (error) {
        console.warn("[messages_realtime] study_invitations_refresh_failed", {
          reason,
          ...toRealtimeLogDetails(error),
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!currentUserId) {
      return;
    }
    let active = true;
    let supabaseClient: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try {
      supabaseClient = getSupabaseBrowserClient();
    } catch (error) {
      console.warn("[messages_realtime] client_init_failed", {
        current_user_id: currentUserId,
        ...toRealtimeLogDetails(error),
      });
      return;
    }

    const shouldNotify = () => didHydrateRealtimeRef.current;
    const normalizedCurrentRole = (currentUserRole ?? "").trim().toLowerCase();
    const officialRoleFilterValue = normalizedCurrentRole || "__pathly_none_role__";

    const handleOfficialMessageChange = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown> | null;
      old: Record<string, unknown> | null;
    }) => {
      if (!active) {
        return;
      }
      const eventType = payload.eventType;
      const newRow = (payload.new ?? null) as Record<string, unknown> | null;
      const oldRow = (payload.old ?? null) as Record<string, unknown> | null;
      const rowId = toStringValue(newRow?.id ?? oldRow?.id);
      if (!rowId) {
        return;
      }

      if (eventType === "DELETE") {
        setSystemMessages((previous) =>
          sortByCreatedAtDesc(previous.filter((item) => item.system_message_id !== rowId)),
        );
        knownOfficialMessageIdsRef.current.delete(rowId);
        return;
      }

      if (!newRow) {
        return;
      }

      const isActiveMessage =
        typeof newRow.is_active === "boolean" ? newRow.is_active : true;
      const targetUserId = toStringValue(newRow.target_user_id);
      const roleTarget = toStringValue(newRow.role_target).trim().toLowerCase();
      const viewerId = currentUserIdRef.current;
      const viewerRole = (currentUserRoleRef.current ?? "").trim().toLowerCase();
      const appliesToUser =
        (targetUserId && targetUserId === viewerId) ||
        (!targetUserId && roleTarget && viewerRole && roleTarget === viewerRole) ||
        (!targetUserId && !roleTarget);

      if (!isActiveMessage || !appliesToUser) {
        setSystemMessages((previous) =>
          previous.filter((item) => item.system_message_id !== rowId),
        );
        knownOfficialMessageIdsRef.current.delete(rowId);
        return;
      }

      const readBy = parseReadBy(newRow.read_by);
      const officialMessage: SystemMessageItem = {
        user_message_id: rowId,
        system_message_id: rowId,
        title: toStringValue(newRow.title) || "Update from Pathly",
        body: toStringValue(newRow.body),
        created_at: toNullableString(newRow.created_at),
        is_read: readBy.includes(viewerId) || newRow.is_read === true,
      };

      const wasKnown = knownOfficialMessageIdsRef.current.has(rowId);
      setSystemMessages((previous) =>
        sortByCreatedAtDesc(
          upsertById(
            previous.map((item) => ({ ...item, id: item.system_message_id })),
            { ...officialMessage, id: officialMessage.system_message_id },
          ).map(({ id, ...rest }) => rest),
        ),
      );
      knownOfficialMessageIdsRef.current.add(rowId);

      if (eventType === "INSERT" && !wasKnown && shouldNotify()) {
        playSound("notification");
      }
      onInboxUpdated?.();
    };

    const handleStudyInvitationChange = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown> | null;
      old: Record<string, unknown> | null;
    }) => {
      if (!active) {
        return;
      }
      const eventType = payload.eventType;
      const newRow = (payload.new ?? null) as Record<string, unknown> | null;
      const oldRow = (payload.old ?? null) as Record<string, unknown> | null;
      const rowId = toStringValue(newRow?.id ?? oldRow?.id);
      const receiverId = toStringValue(newRow?.receiver_id ?? oldRow?.receiver_id);
      const roomId = toStringValue(newRow?.room_id ?? oldRow?.room_id);
      if (!rowId) {
        return;
      }
      if (receiverId && receiverId !== currentUserIdRef.current) {
        console.info("[messages_realtime] study_invitation_ignored_receiver_mismatch", {
          invitation_id: rowId,
          receiver_id: receiverId,
          viewer_id: currentUserIdRef.current,
          room_id: roomId || null,
          event_type: eventType,
        });
        return;
      }

      console.info("[messages_realtime] study_invitation_event", {
        invitation_id: rowId,
        receiver_id: receiverId || null,
        viewer_id: currentUserIdRef.current,
        room_id: roomId || null,
        event_type: eventType,
      });

      if (eventType === "DELETE") {
        setStudyInvitations((previous) => {
          const next = sortByCreatedAtDesc(previous.filter((item) => item.id !== rowId));
          console.info("[messages_realtime] study_invitation_state_updated", {
            event_type: eventType,
            invitation_id: rowId,
            count_before: previous.length,
            count_after: next.length,
          });
          return next;
        });
        knownStudyInvitationIdsRef.current.delete(rowId);
        onInboxUpdatedRef.current?.();
        return;
      }

      if (!newRow) {
        return;
      }

      setStudyInvitations((previous) => {
        const existing = previous.find((item) => item.id === rowId) ?? null;
        const mapped: StudyInvitationItem = {
          id: rowId,
          room_id: toStringValue(newRow.room_id),
          sender_id: toStringValue(newRow.sender_id),
          receiver_id: toStringValue(newRow.receiver_id),
          status: toStringValue(newRow.status) || existing?.status || "pending",
          created_at: toNullableString(newRow.created_at) ?? existing?.created_at ?? null,
          responded_at: toNullableString(newRow.responded_at) ?? existing?.responded_at ?? null,
          sender_username: toStringValue(newRow.sender_username) || existing?.sender_username || "Friend",
          room_name: toStringValue(newRow.room_name) || existing?.room_name || "Study Room Invitation",
          room_password: toStringValue(newRow.room_password) || existing?.room_password || "",
          room_style: toStringValue(newRow.room_style) || existing?.room_style || "focus",
          room_duration_minutes:
            typeof newRow.room_duration_minutes === "number"
              ? newRow.room_duration_minutes
              : existing?.room_duration_minutes ?? 60,
          room_status: toStringValue(newRow.room_status) || existing?.room_status || "active",
          room_expires_at: toNullableString(newRow.room_expires_at) ?? existing?.room_expires_at ?? null,
        };
        const next = sortByCreatedAtDesc(upsertById(previous, mapped));
        console.info("[messages_realtime] study_invitation_state_updated", {
          event_type: eventType,
          invitation_id: rowId,
          count_before: previous.length,
          count_after: next.length,
          accepted: true,
        });
        return next;
      });

      const wasKnown = knownStudyInvitationIdsRef.current.has(rowId);
      knownStudyInvitationIdsRef.current.add(rowId);
      if (eventType === "INSERT" && !wasKnown && shouldNotify()) {
        playSound("notification");
      }
      onInboxUpdatedRef.current?.();
      if (eventType === "INSERT" || eventType === "UPDATE") {
        void refreshStudyInvitationsFromServer(`realtime_${eventType.toLowerCase()}`);
      }
    };

    const handleFriendshipChange = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown> | null;
      old: Record<string, unknown> | null;
    }) => {
      if (!active) {
        return;
      }
      const eventType = payload.eventType;
      const newRow = (payload.new ?? null) as Record<string, unknown> | null;
      const oldRow = (payload.old ?? null) as Record<string, unknown> | null;
      const row = newRow ?? oldRow;
      if (!row) {
        return;
      }
      const friendshipId = toStringValue(row.id);
      if (!friendshipId) {
        return;
      }
      const requesterId = toStringValue(row.requester_id);
      const addresseeId = toStringValue(row.addressee_id);
      const status = toStringValue((newRow ?? row).status).toLowerCase();
      const viewerId = currentUserIdRef.current;
      const isIncoming = addresseeId === viewerId;
      const isOutgoing = requesterId === viewerId;
      if (!isIncoming && !isOutgoing) {
        return;
      }
      if (!isIncoming) {
        onInboxUpdatedRef.current?.();
        return;
      }

      if (eventType === "DELETE" || status !== "pending") {
        setFriendRequests((previous) =>
          sortByCreatedAtDesc(previous.filter((item) => item.friendship_id !== friendshipId)),
        );
        knownIncomingFriendshipIdsRef.current.delete(friendshipId);
        onInboxUpdatedRef.current?.();
        return;
      }

      setFriendRequests((previous) => {
        const existing = previous.find((item) => item.friendship_id === friendshipId) ?? null;
        const mapped: FriendRequestItem = {
          friendship_id: friendshipId,
          sender: {
            id: requesterId,
            username: toStringValue(newRow?.requester_username) || existing?.sender.username || "New requester",
            avatar_url: toNullableString(newRow?.requester_avatar_url) ?? existing?.sender.avatar_url ?? null,
            current_learning_field_title:
              toNullableString(newRow?.requester_current_learning_field_title) ??
              existing?.sender.current_learning_field_title ??
              null,
          },
          status: "pending",
          created_at: toNullableString(newRow?.created_at) ?? existing?.created_at ?? null,
        };
        return sortByCreatedAtDesc(
          upsertById(
            previous.map((item) => ({ ...item, id: item.friendship_id })),
            { ...mapped, id: mapped.friendship_id },
          ).map(({ id, ...rest }) => rest),
        );
      });

      const wasKnown = knownIncomingFriendshipIdsRef.current.has(friendshipId);
      knownIncomingFriendshipIdsRef.current.add(friendshipId);
      if (!wasKnown && shouldNotify()) {
        playSound("notification");
      }
      onInboxUpdatedRef.current?.();
    };

    console.info("[messages_realtime] subscription_start", {
      current_user_id: currentUserId,
      current_user_role: currentUserRole ?? null,
      channel: `messages-panel:${currentUserId}`,
      study_invitation_filter: `receiver_id=eq.${currentUserId}`,
    });

    const channel = supabaseClient
      .channel(`messages-panel:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "official_messages",
          filter: `target_user_id=eq.${currentUserId}`,
        },
        handleOfficialMessageChange,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "official_messages",
          filter: "target_user_id=is.null",
        },
        handleOfficialMessageChange,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "official_messages",
          filter: `role_target=eq.${officialRoleFilterValue}`,
        },
        handleOfficialMessageChange,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "study_room_invitations",
          filter: `receiver_id=eq.${currentUserId}`,
        },
        handleStudyInvitationChange,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
          filter: `addressee_id=eq.${currentUserId}`,
        },
        handleFriendshipChange,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
          filter: `requester_id=eq.${currentUserId}`,
        },
        handleFriendshipChange,
      )
      .subscribe((status, error) => {
        console.info("[messages_realtime] subscription_status", {
          current_user_id: currentUserId,
          status,
          ...(error ? toRealtimeLogDetails(error) : {}),
        });
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[messages_realtime] subscription_failed", {
            current_user_id: currentUserId,
            status,
            ...(error ? toRealtimeLogDetails(error) : {}),
          });
        }
      });

    return () => {
      active = false;
      console.info("[messages_realtime] subscription_cleanup", {
        current_user_id: currentUserId,
        channel: `messages-panel:${currentUserId}`,
      });
      void channel.unsubscribe();
      if (supabaseClient) {
        void supabaseClient.removeChannel(channel);
      }
    };
  }, [currentUserId, currentUserRole, refreshStudyInvitationsFromServer]);

  const unreadSystemMessagesCount = useMemo(
    () => systemMessages.filter((message) => !message.is_read).length,
    [systemMessages],
  );

  const pendingStudyInvitationsCount = useMemo(
    () => studyInvitations.filter((invitation) => invitation.status === "pending").length,
    [studyInvitations],
  );

  async function handleRespondFriendRequest(friendshipId: string, action: "accepted" | "declined") {
    setRespondingRequestId(friendshipId);
    try {
      const response = await fetch("/api/messages/friend-requests/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friendship_id: friendshipId,
          action,
        }),
      });

      const payload = (await response.json()) as RespondFriendRequestApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to respond to this friend request.");
      }

      setFriendRequests((previous) =>
        previous.filter((request) => request.friendship_id !== friendshipId),
      );
      onInboxUpdated?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to respond to this friend request.";
      setPanelError(message);
    } finally {
      setRespondingRequestId("");
    }
  }

  async function handleMarkSystemMessageAsRead(userMessageId: string) {
    setMarkingReadId(userMessageId);
    try {
      const response = await fetch("/api/messages/system/read", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_message_id: userMessageId,
        }),
      });

      const payload = (await response.json()) as MarkSystemMessageReadApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to mark this message as read.");
      }

      setSystemMessages((previous) =>
        previous.map((message) =>
          message.user_message_id === userMessageId
            ? {
                ...message,
                is_read: true,
              }
            : message,
        ),
      );
      onInboxUpdated?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to mark this message as read.";
      setPanelError(message);
    } finally {
      setMarkingReadId("");
    }
  }

  async function handleRespondStudyInvitation(
    invitationId: string,
    action: "accepted" | "declined",
  ) {
    setRespondingInvitationId(invitationId);
    try {
      const response = await fetch("/api/messages/study-invitations/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invitation_id: invitationId,
          action,
        }),
      });
      const payload = (await response.json()) as RespondStudyInvitationApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to respond to this invitation.");
      }

      setStudyInvitations((previous) =>
        previous.map((invitation) =>
          invitation.id === invitationId
            ? {
                ...invitation,
                status: action,
                responded_at: new Date().toISOString(),
              }
            : invitation,
        ),
      );

      onInboxUpdated?.();

      if (action === "accepted" && payload.room_id && onOpenStudyRoom) {
        onOpenStudyRoom(payload.room_id);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to respond to this invitation.";
      setPanelError(message);
    } finally {
      setRespondingInvitationId("");
    }
  }

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-extrabold text-[#1F2937]">Messages</h2>
          <p className="text-sm font-semibold text-[#1F2937]/70">
            Friend requests, study room invites, and official Pathly updates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadInboxData();
          }}
          className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-base"
        >
          Refresh
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("friend_requests")}
          className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-extrabold transition ${
            activeTab === "friend_requests"
              ? "border-[#1F2937] bg-[#58CC02] text-white shadow-[0_3px_0_#1f2937]"
              : "border-[#1F2937]/15 bg-white text-[#1F2937] hover:border-[#58CC02]/45 hover:bg-[#58CC02]/10"
          }`}
        >
          Friend Requests
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-extrabold leading-none">
            {friendRequests.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("official_messages")}
          className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-extrabold transition ${
            activeTab === "official_messages"
              ? "border-[#1F2937] bg-[#FFD84D] text-[#1F2937] shadow-[0_3px_0_#1f2937]"
              : "border-[#1F2937]/15 bg-white text-[#1F2937] hover:border-[#FFD84D]/60 hover:bg-[#FFD84D]/20"
          }`}
        >
          Official Messages
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#1F2937]/12 px-1.5 py-0.5 text-[10px] font-extrabold leading-none">
            {unreadSystemMessagesCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("study_invitations")}
          className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-extrabold transition ${
            activeTab === "study_invitations"
              ? "border-[#1F2937] bg-[#58CC02] text-white shadow-[0_3px_0_#1f2937]"
              : "border-[#1F2937]/15 bg-white text-[#1F2937] hover:border-[#58CC02]/50 hover:bg-[#58CC02]/12"
          }`}
        >
          Study invitations
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-extrabold leading-none">
            {pendingStudyInvitationsCount}
          </span>
        </button>
      </div>

      {panelError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {panelError}
        </p>
      ) : null}

      {isLoading ? (
        <div className="mt-5 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-5 text-sm font-semibold text-[#1F2937]/70">
          Loading inbox...
        </div>
      ) : null}

      {!isLoading && activeTab === "friend_requests" ? (
        <div className="mt-5 space-y-3">
          {friendRequestsLoaded && friendRequests.length === 0 ? (
            <article className="rounded-2xl border-2 border-dashed border-[#1F2937]/15 bg-[#F8FCFF] p-5">
              <p className="text-base font-extrabold text-[#1F2937]">
                No new friend requests right now.
              </p>
              <p className="mt-1 text-sm font-semibold text-[#1F2937]/68">
                Your inbox is quiet for now.
              </p>
            </article>
          ) : friendRequestsLoaded ? (
            friendRequests.map((request) => (
              <article
                key={request.friendship_id}
                className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setAvatarPreview({
                          avatarUrl: request.sender.avatar_url,
                          fallbackInitial: toInitial(request.sender.username),
                          displayName: request.sender.username,
                        })
                      }
                      className="rounded-full transition hover:scale-[1.02]"
                      aria-label={`Preview ${request.sender.username} avatar`}
                    >
                      {request.sender.avatar_url ? (
                        <Image
                          src={request.sender.avatar_url}
                          alt={`${request.sender.username} avatar`}
                          width={44}
                          height={44}
                          className="h-11 w-11 rounded-full border-2 border-[#1F2937]/15 object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-sm font-extrabold text-[#1F2937]">
                          {toInitial(request.sender.username)}
                        </div>
                      )}
                    </button>
                    <div>
                      <p className="text-sm font-extrabold text-[#1F2937]">
                        {request.sender.username}
                      </p>
                      <p className="text-xs font-semibold text-[#1F2937]/65">
                        {request.sender.current_learning_field_title ?? "No active learning field"}
                      </p>
                      <p className="text-[11px] font-semibold uppercase text-[#1F2937]/55">
                        {request.status}
                      </p>
                      <p className="text-[11px] font-semibold text-[#1F2937]/55">
                        {formatTimestamp(request.created_at)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleRespondFriendRequest(request.friendship_id, "declined")
                      }
                      disabled={respondingRequestId === request.friendship_id}
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void handleRespondFriendRequest(request.friendship_id, "accepted")
                      }
                      disabled={respondingRequestId === request.friendship_id}
                      className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Accept
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : null}
        </div>
      ) : null}

      {!isLoading && activeTab === "official_messages" ? (
        <div className="mt-5 space-y-3">
          {systemMessages.length === 0 ? (
            <article className="rounded-2xl border-2 border-dashed border-[#1F2937]/15 bg-[#F8FCFF] p-5">
              <p className="text-base font-extrabold text-[#1F2937]">Your inbox is quiet for now.</p>
              <p className="mt-1 text-sm font-semibold text-[#1F2937]/68">
                Official updates from Pathly will appear here.
              </p>
            </article>
          ) : (
            systemMessages.map((message) => (
              <article
                key={message.user_message_id}
                className={`rounded-2xl border-2 p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)] ${
                  message.is_read
                    ? "border-[#1F2937]/12 bg-white"
                    : "border-[#1F2937]/20 bg-[#FFF9DD]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-extrabold text-[#1F2937]">{message.title}</p>
                    <p className="mt-1 text-sm font-semibold text-[#1F2937]/72">{message.body}</p>
                    <p className="mt-2 text-[11px] font-semibold text-[#1F2937]/55">
                      {formatTimestamp(message.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
                        message.is_read
                          ? "bg-[#1F2937]/10 text-[#1F2937]/70"
                          : "bg-[#58CC02] text-white"
                      }`}
                    >
                      {message.is_read ? "Read" : "Unread"}
                    </span>
                    {!message.is_read ? (
                      <button
                        type="button"
                        onClick={() => void handleMarkSystemMessageAsRead(message.user_message_id)}
                        disabled={markingReadId === message.user_message_id}
                        className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        Mark Read
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}

      {!isLoading && activeTab === "study_invitations" ? (
        <div className="mt-5 space-y-3">
          {studyInvitations.length === 0 ? (
            <article className="rounded-2xl border-2 border-dashed border-[#1F2937]/15 bg-[#F8FCFF] p-5">
              <p className="text-base font-extrabold text-[#1F2937]">No study room invitations yet.</p>
              <p className="mt-1 text-sm font-semibold text-[#1F2937]/68">
                Invitations from your friends will appear here.
              </p>
            </article>
          ) : (
            studyInvitations.map((invitation) => (
              <article
                key={invitation.id}
                className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-base font-extrabold text-[#1F2937]">{invitation.room_name}</p>
                    <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
                      {invitation.sender_username} invited you to this study room.
                    </p>
                    <p className="mt-2 text-xs font-semibold text-[#1F2937]/65">
                      Room ID: {invitation.room_id}
                    </p>
                    <p className="text-xs font-semibold text-[#1F2937]/65">
                      Password: {invitation.room_password}
                    </p>
                    <p className="text-xs font-semibold text-[#1F2937]/65">
                      Style: {invitation.room_style} · Duration: {invitation.room_duration_minutes} minutes
                    </p>
                    <p className="text-[11px] font-semibold text-[#1F2937]/55">
                      {formatTimestamp(invitation.created_at)}
                    </p>
                  </div>

                  {invitation.status === "pending" ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRespondStudyInvitation(invitation.id, "declined")}
                        disabled={respondingInvitationId === invitation.id}
                        className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRespondStudyInvitation(invitation.id, "accepted")}
                        disabled={respondingInvitationId === invitation.id}
                        className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        Accept
                      </button>
                    </div>
                  ) : (
                    <span className="rounded-full bg-[#1F2937]/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[#1F2937]/70">
                      {invitation.status}
                    </span>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}

      <AvatarPreviewModal
        isOpen={Boolean(avatarPreview)}
        avatarUrl={avatarPreview?.avatarUrl ?? null}
        fallbackInitial={avatarPreview?.fallbackInitial ?? "M"}
        displayName={avatarPreview?.displayName ?? "Avatar"}
        onClose={() => setAvatarPreview(null)}
      />
    </section>
  );
}

