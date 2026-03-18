"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

type MessagesPanelProps = {
  onInboxUpdated?: () => void;
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

type StudyInvitationItem = {
  id: string;
  sender_id: string;
  receiver_id: string;
  learning_field_id: string | null;
  status: string;
  created_at: string | null;
  responded_at: string | null;
  sender: {
    id: string;
    username: string;
  };
  learning_field_title: string | null;
};

type StudySessionItem = {
  id: string;
  invitation_id: string | null;
  user_a_id: string;
  user_b_id: string;
  learning_field_id: string | null;
  learning_field_title: string | null;
  status: string;
  created_at: string | null;
  ended_at: string | null;
};

type StudySessionMessage = {
  id: string;
  session_id: string;
  sender_id: string;
  body: string;
  created_at: string | null;
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

type StudyInvitationsApiResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  invitations?: StudyInvitationItem[];
  active_sessions?: StudySessionItem[];
};

type RespondFriendRequestApiResponse = {
  success: boolean;
  message?: string;
};

type MarkSystemMessageReadApiResponse = {
  success: boolean;
  message?: string;
};

type RespondStudyInvitationApiResponse = {
  success: boolean;
  message?: string;
  invitation_id?: string;
  session?: StudySessionItem | null;
};

type StudySessionApiResponse = {
  success: boolean;
  message?: string;
  session?: StudySessionItem;
};

type StudySessionMessagesApiResponse = {
  success: boolean;
  message?: string;
  messages?: StudySessionMessage[];
  sent_message?: StudySessionMessage;
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

export default function MessagesPanel({ onInboxUpdated }: MessagesPanelProps) {
  const [activeTab, setActiveTab] = useState<MessagesTab>("friend_requests");
  const [currentUserId, setCurrentUserId] = useState("");
  const [friendRequests, setFriendRequests] = useState<FriendRequestItem[]>([]);
  const [friendRequestsLoaded, setFriendRequestsLoaded] = useState(false);
  const [systemMessages, setSystemMessages] = useState<SystemMessageItem[]>([]);
  const [studyInvitations, setStudyInvitations] = useState<StudyInvitationItem[]>([]);
  const [activeStudySessions, setActiveStudySessions] = useState<StudySessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [panelError, setPanelError] = useState("");
  const [respondingRequestId, setRespondingRequestId] = useState("");
  const [markingReadId, setMarkingReadId] = useState("");
  const [respondingStudyInvitationId, setRespondingStudyInvitationId] = useState("");

  const [studySessionModalOpen, setStudySessionModalOpen] = useState(false);
  const [selectedStudySession, setSelectedStudySession] = useState<StudySessionItem | null>(null);
  const [studySessionMessages, setStudySessionMessages] = useState<StudySessionMessage[]>([]);
  const [studySessionError, setStudySessionError] = useState("");
  const [isLoadingStudySession, setIsLoadingStudySession] = useState(false);
  const [studySessionDraft, setStudySessionDraft] = useState("");
  const [isSendingStudyMessage, setIsSendingStudyMessage] = useState(false);

  const loadInboxData = useCallback(async () => {
    setIsLoading(true);
    setPanelError("");
    setFriendRequestsLoaded(false);

    try {
      const [friendResult, systemResult, studyResult] = await Promise.allSettled([
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

      if (friendResult.status === "fulfilled") {
        const friendResponse = friendResult.value;
        const friendPayload = (await friendResponse.json()) as FriendRequestsApiResponse;
        if (friendResponse.ok && friendPayload.success && Array.isArray(friendPayload.friend_requests)) {
          setFriendRequests(friendPayload.friend_requests);
          setFriendRequestsLoaded(true);
          if (!resolvedCurrentUserId && friendPayload.current_user_id?.trim()) {
            resolvedCurrentUserId = friendPayload.current_user_id.trim();
          }
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
          if (!resolvedCurrentUserId && systemPayload.current_user_id?.trim()) {
            resolvedCurrentUserId = systemPayload.current_user_id.trim();
          }
        } else {
          sectionErrors.push(systemPayload.message ?? "Unable to load official messages.");
        }
      } else {
        sectionErrors.push("Unable to load official messages.");
      }

      if (studyResult.status === "fulfilled") {
        const studyResponse = studyResult.value;
        const studyPayload = (await studyResponse.json()) as StudyInvitationsApiResponse;
        if (studyResponse.ok && studyPayload.success) {
          setStudyInvitations(studyPayload.invitations ?? []);
          setActiveStudySessions(studyPayload.active_sessions ?? []);
          if (!resolvedCurrentUserId && studyPayload.current_user_id?.trim()) {
            resolvedCurrentUserId = studyPayload.current_user_id.trim();
          }
        } else {
          sectionErrors.push(studyPayload.message ?? "Unable to load study invitations.");
        }
      } else {
        sectionErrors.push("Unable to load study invitations.");
      }

      if (resolvedCurrentUserId) {
        setCurrentUserId(resolvedCurrentUserId);
      } else {
        setCurrentUserId("");
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
    setRespondingStudyInvitationId(invitationId);

    try {
      const response = await fetch("/api/study/respond", {
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
        previous.filter((invitation) => invitation.id !== invitationId),
      );

      if (payload.session && action === "accepted") {
        setActiveStudySessions((previous) => {
          if (previous.some((session) => session.id === payload.session?.id)) {
            return previous;
          }
          return [payload.session as StudySessionItem, ...previous];
        });
        await handleOpenStudySession(payload.session.id);
      }

      onInboxUpdated?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to respond to this invitation.";
      setPanelError(message);
    } finally {
      setRespondingStudyInvitationId("");
    }
  }

  async function handleOpenStudySession(sessionId: string) {
    setStudySessionModalOpen(true);
    setIsLoadingStudySession(true);
    setStudySessionError("");
    setSelectedStudySession(null);
    setStudySessionMessages([]);

    try {
      const [sessionResponse, messagesResponse] = await Promise.all([
        fetch(`/api/study/sessions/${sessionId}`, {
          method: "GET",
          cache: "no-store",
        }),
        fetch(`/api/study/sessions/${sessionId}/messages?limit=100`, {
          method: "GET",
          cache: "no-store",
        }),
      ]);

      const sessionPayload = (await sessionResponse.json()) as StudySessionApiResponse;
      const messagesPayload = (await messagesResponse.json()) as StudySessionMessagesApiResponse;

      if (!sessionResponse.ok || !sessionPayload.success || !sessionPayload.session) {
        throw new Error(sessionPayload.message ?? "Unable to load study session.");
      }
      if (!messagesResponse.ok || !messagesPayload.success) {
        throw new Error(messagesPayload.message ?? "Unable to load study session chat.");
      }

      setSelectedStudySession(sessionPayload.session);
      setStudySessionMessages(messagesPayload.messages ?? []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load study session chat.";
      setStudySessionError(message);
    } finally {
      setIsLoadingStudySession(false);
    }
  }

  async function handleSendStudyMessage() {
    const text = studySessionDraft.trim();
    if (!selectedStudySession || !text) {
      return;
    }

    setIsSendingStudyMessage(true);
    setStudySessionError("");

    try {
      const response = await fetch(`/api/study/sessions/${selectedStudySession.id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: text,
        }),
      });

      const payload = (await response.json()) as StudySessionMessagesApiResponse;
      if (!response.ok || !payload.success || !payload.sent_message) {
        throw new Error(payload.message ?? "Unable to send study message right now.");
      }

      setStudySessionMessages((previous) => [...previous, payload.sent_message as StudySessionMessage]);
      setStudySessionDraft("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to send study message right now.";
      setStudySessionError(message);
    } finally {
      setIsSendingStudyMessage(false);
    }
  }

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-extrabold text-[#1F2937]">Messages</h2>
          <p className="text-sm font-semibold text-[#1F2937]/70">
            Friend requests, study invitations, and official Pathly updates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadInboxData();
          }}
          className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-base !text-[#1F2937]"
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
          onClick={() => setActiveTab("study_invitations")}
          className={`inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-extrabold transition ${
            activeTab === "study_invitations"
              ? "border-[#1F2937] bg-[#58CC02] text-white shadow-[0_3px_0_#1f2937]"
              : "border-[#1F2937]/15 bg-white text-[#1F2937] hover:border-[#58CC02]/45 hover:bg-[#58CC02]/10"
          }`}
        >
          Study Invitations
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-extrabold leading-none">
            {studyInvitations.length}
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
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm !text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
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

      {!isLoading && activeTab === "study_invitations" ? (
        <div className="mt-5 space-y-3">
          {studyInvitations.length === 0 && activeStudySessions.length === 0 ? (
            <article className="rounded-2xl border-2 border-dashed border-[#1F2937]/15 bg-[#F8FCFF] p-5">
              <p className="text-base font-extrabold text-[#1F2937]">No study invites right now.</p>
              <p className="mt-1 text-sm font-semibold text-[#1F2937]/68">
                New study invitations will appear here.
              </p>
            </article>
          ) : null}

          {studyInvitations.map((invitation) => (
            <article
              key={invitation.id}
              className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-extrabold text-[#1F2937]">
                    {invitation.sender.username} invited you to study together.
                  </p>
                  <p className="text-xs font-semibold text-[#1F2937]/65">
                    {invitation.learning_field_title ?? "General study session"}
                  </p>
                  <p className="text-[11px] font-semibold text-[#1F2937]/55">
                    {formatTimestamp(invitation.created_at)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRespondStudyInvitation(invitation.id, "declined")}
                    disabled={respondingStudyInvitationId === invitation.id}
                    className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm !text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRespondStudyInvitation(invitation.id, "accepted")}
                    disabled={respondingStudyInvitationId === invitation.id}
                    className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Accept
                  </button>
                </div>
              </div>
            </article>
          ))}

          {activeStudySessions.length > 0 ? (
            <div className="pt-2">
              <p className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                Active Study Sessions
              </p>
              <div className="mt-2 space-y-3">
                {activeStudySessions.map((session) => {
                  const partnerId = session.user_a_id === currentUserId ? session.user_b_id : session.user_a_id;
                  return (
                    <article
                      key={session.id}
                      className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-extrabold text-[#1F2937]">
                            Session with {partnerId}
                          </p>
                          <p className="text-xs font-semibold text-[#1F2937]/65">
                            {session.learning_field_title ?? "General"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void handleOpenStudySession(session.id);
                          }}
                          className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm"
                        >
                          Open Session
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
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
                        className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-3 !text-xs !text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
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

      {studySessionModalOpen ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-2xl rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-2xl font-extrabold text-[#1F2937]">Study Session</h3>
              <button
                type="button"
                onClick={() => {
                  setStudySessionModalOpen(false);
                  setSelectedStudySession(null);
                  setStudySessionMessages([]);
                  setStudySessionError("");
                }}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm !text-[#1F2937]"
              >
                Close
              </button>
            </div>

            {isLoadingStudySession ? (
              <p className="mt-4 text-sm font-semibold text-[#1F2937]/70">Loading session...</p>
            ) : null}

            {studySessionError ? (
              <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {studySessionError}
              </p>
            ) : null}

            {!isLoadingStudySession && selectedStudySession ? (
              <>
                <p className="mt-4 text-sm font-semibold text-[#1F2937]/72">
                  {selectedStudySession.learning_field_title ?? "General study"}
                </p>

                <div className="mt-4 flex h-64 flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-[#1F2937]/10 bg-[#F9FCFF] p-3">
                  {studySessionMessages.length === 0 ? (
                    <div className="my-auto text-center text-sm font-semibold text-[#1F2937]/65">
                      No messages yet. Start your shared study chat.
                    </div>
                  ) : (
                    studySessionMessages.map((message) => {
                      const isMe = message.sender_id === currentUserId;
                      return (
                        <div
                          key={message.id}
                          className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm font-semibold ${
                            isMe
                              ? "ml-auto bg-[#58CC02] text-white"
                              : "mr-auto border-2 border-[#1F2937]/10 bg-white text-[#1F2937]"
                          }`}
                        >
                          <p>{message.body}</p>
                          <p className={`mt-1 text-[11px] ${isMe ? "text-white/80" : "text-[#1F2937]/55"}`}>
                            {formatTimestamp(message.created_at)}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="text"
                    value={studySessionDraft}
                    onChange={(event) => setStudySessionDraft(event.target.value)}
                    placeholder="Send a study message..."
                    className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleSendStudyMessage();
                    }}
                    disabled={isSendingStudyMessage}
                    className="btn-3d btn-3d-green inline-flex h-12 shrink-0 items-center justify-center px-6 !text-base disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSendingStudyMessage ? "Sending..." : "Send"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
