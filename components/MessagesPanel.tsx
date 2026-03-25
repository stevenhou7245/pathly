"use client";

import AvatarPreviewModal from "@/components/AvatarPreviewModal";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

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

export default function MessagesPanel({ onInboxUpdated, onOpenStudyRoom }: MessagesPanelProps) {
  const [activeTab, setActiveTab] = useState<MessagesTab>("friend_requests");
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([]);
  const [friendRequestsLoaded, setFriendRequestsLoaded] = useState(false);
  const [systemMessages, setSystemMessages] = useState<SystemMessageItem[]>([]);
  const [studyInvitations, setStudyInvitations] = useState<StudyInvitationItem[]>([]);
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

      if (friendResult.status === "fulfilled") {
        const friendResponse = friendResult.value;
        const friendPayload = (await friendResponse.json()) as FriendRequestsApiResponse;
        if (friendResponse.ok && friendPayload.success && Array.isArray(friendPayload.friend_requests)) {
          setFriendRequests(friendPayload.friend_requests);
          setFriendRequestsLoaded(true);
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
          setSystemMessages(systemPayload.system_messages ?? []);
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
          setStudyInvitations(invitationsPayload.study_invitations ?? []);
        } else {
          sectionErrors.push(
            invitationsPayload.message ?? "Unable to load study room invitations.",
          );
        }
      } else {
        sectionErrors.push("Unable to load study room invitations.");
      }

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

