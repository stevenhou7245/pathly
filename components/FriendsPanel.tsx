"use client";

import FriendChatPanel from "@/components/FriendChatPanel";
import { useEffect, useMemo, useRef, useState } from "react";

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

type FriendsApiResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  friends?: FriendListItem[];
};

type DirectMessageItem = {
  id: string;
  friendship_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string | null;
};

type FriendshipMessagesApiResponse = {
  success: boolean;
  message?: string;
  messages?: DirectMessageItem[];
};

type SendMessageApiResponse = {
  success: boolean;
  message?: string;
  direct_message?: DirectMessageItem;
};

type SearchUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  age: number | null;
  motto: string | null;
  bio: string | null;
  current_learning_field_title: string | null;
  existing_friendship_status: string | null;
};

type FriendSearchApiResponse = {
  success: boolean;
  message?: string;
  user?: SearchUser | null;
};

type SendFriendRequestApiResponse = {
  success: boolean;
  message?: string;
};

type FriendProfile = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  age: number | null;
  motto: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  current_learning_field: {
    field_id: string;
    title: string | null;
    created_at: string | null;
  } | null;
  current_level: string | null;
  target_level: string | null;
  progress_summary: {
    completed_steps_count: number;
    total_steps_count: number;
    percentage_progress: number;
  } | null;
};

type FriendProfileApiResponse = {
  success: boolean;
  message?: string;
  profile?: FriendProfile;
};

type InviteStudyApiResponse = {
  success: boolean;
  message?: string;
  invitation_id?: string;
};

type MessageStore = Record<string, DirectMessageItem[]>;
type ProfileStore = Record<string, FriendProfile>;

type FriendsFetchResult = {
  status: number;
  payload: FriendsApiResponse;
  reused_inflight: boolean;
};

const friendsFetchInFlight = new Map<
  string,
  Promise<{
    status: number;
    payload: FriendsApiResponse;
  }>
>();

async function fetchFriendsListWithDedupe(): Promise<FriendsFetchResult> {
  const dedupeKey = "friends:list";
  const inFlight = friendsFetchInFlight.get(dedupeKey);
  if (inFlight) {
    const reusedPayload = await inFlight;
    return {
      ...reusedPayload,
      reused_inflight: true,
    };
  }

  const fetchPromise = (async () => {
    const friendsResponse = await fetch("/api/friends", {
      method: "GET",
      cache: "no-store",
    });
    const friendsPayload = (await friendsResponse.json()) as FriendsApiResponse;
    return {
      status: friendsResponse.status,
      payload: friendsPayload,
    };
  })();

  friendsFetchInFlight.set(dedupeKey, fetchPromise);
  try {
    const payload = await fetchPromise;
    return {
      ...payload,
      reused_inflight: false,
    };
  } finally {
    friendsFetchInFlight.delete(dedupeKey);
  }
}

function toInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "M";
}

function getRelationshipLabel(status: string | null) {
  if (status === "pending") {
    return "Request pending";
  }
  if (status === "accepted") {
    return "Already friends";
  }
  if (status === "declined") {
    return "Already requested before";
  }
  return "";
}

export default function FriendsPanel() {
  const [currentUserId, setCurrentUserId] = useState("");
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(true);
  const [friendsError, setFriendsError] = useState("");

  const [selectedFriendshipId, setSelectedFriendshipId] = useState("");
  const [messagesByFriendship, setMessagesByFriendship] = useState<MessageStore>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const [friendProfiles, setFriendProfiles] = useState<ProfileStore>({});
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<FriendProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  const [isSendingStudyInvitation, setIsSendingStudyInvitation] = useState(false);
  const [studyFeedback, setStudyFeedback] = useState("");
  const [studyError, setStudyError] = useState("");

  const [isAddFriendModalOpen, setIsAddFriendModalOpen] = useState(false);
  const [searchUsername, setSearchUsername] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResult, setSearchResult] = useState<SearchUser | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedSearchUser, setSelectedSearchUser] = useState<SearchUser | null>(null);
  const [isSendingRequest, setIsSendingRequest] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState("");
  const [requestError, setRequestError] = useState("");
  const latestLoadRequestIdRef = useRef(0);
  const fetchCountRef = useRef(0);
  const currentUserIdRef = useRef("");
  const selectedFriendshipIdRef = useRef("");
  const isMountedRef = useRef(false);

  const selectedFriend = useMemo(
    () => friends.find((friend) => friend.friendship_id === selectedFriendshipId) ?? null,
    [friends, selectedFriendshipId],
  );

  const selectedMessages = useMemo(
    () => (selectedFriend ? messagesByFriendship[selectedFriend.friendship_id] ?? [] : []),
    [messagesByFriendship, selectedFriend],
  );

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    selectedFriendshipIdRef.current = selectedFriendshipId;
  }, [selectedFriendshipId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function loadFriends(options?: { reason?: "mount" | "manual_refresh" }) {
    const reason = options?.reason ?? "manual_refresh";
    const requestId = latestLoadRequestIdRef.current + 1;
    latestLoadRequestIdRef.current = requestId;
    fetchCountRef.current += 1;

    if (process.env.NODE_ENV !== "production") {
      console.info("[friends_panel] load_friends:start", {
        request_id: requestId,
        fetch_count: fetchCountRef.current,
        reason,
        current_user_id_state: currentUserIdRef.current || null,
        selected_friendship_id_state: selectedFriendshipIdRef.current || null,
      });
    }

    setIsLoadingFriends(true);
    setFriendsError("");

    try {
      const result = await fetchFriendsListWithDedupe();
      if (!isMountedRef.current || latestLoadRequestIdRef.current !== requestId) {
        if (process.env.NODE_ENV !== "production") {
          console.info("[friends_panel] load_friends:stale_response_ignored", {
            request_id: requestId,
            current_request_id: latestLoadRequestIdRef.current,
          });
        }
        return;
      }

      if (process.env.NODE_ENV !== "production") {
        console.info("[friends_panel] load_friends:response", {
          request_id: requestId,
          status: result.status,
          success: result.payload.success,
          reused_inflight: result.reused_inflight,
        });
      }

      if (result.status >= 400 || !result.payload.success) {
        throw new Error(result.payload.message ?? "Unable to load friends right now.");
      }
      setCurrentUserId(result.payload.current_user_id?.trim() ?? "");

      const nextFriends = (result.payload.friends ?? []).filter(
        (friend) => friend.friendship_status === "accepted",
      );
      setFriends(nextFriends);
      setSelectedFriendshipId((previous) => {
        if (previous && nextFriends.some((friend) => friend.friendship_id === previous)) {
          return previous;
        }
        return nextFriends[0]?.friendship_id ?? "";
      });
      if (process.env.NODE_ENV !== "production") {
        console.info("[friends_panel] load_friends:success", {
          request_id: requestId,
          friends_count: nextFriends.length,
          resolved_current_user_id: result.payload.current_user_id?.trim() ?? null,
        });
      }
    } catch (error) {
      if (!isMountedRef.current || latestLoadRequestIdRef.current !== requestId) {
        if (process.env.NODE_ENV !== "production") {
          console.info("[friends_panel] load_friends:stale_error_ignored", {
            request_id: requestId,
            current_request_id: latestLoadRequestIdRef.current,
          });
        }
        return;
      }
      const message = error instanceof Error ? error.message : "Unable to load friends right now.";
      setFriendsError(message);
      setFriends([]);
      setSelectedFriendshipId("");
      if (process.env.NODE_ENV !== "production") {
        console.warn("[friends_panel] load_friends:error", {
          request_id: requestId,
          message,
        });
      }
    } finally {
      if (isMountedRef.current && latestLoadRequestIdRef.current === requestId) {
        setIsLoadingFriends(false);
      }
    }
  }

  async function loadMessagesForFriendship(friendshipId: string) {
    if (!friendshipId) {
      return;
    }

    setIsLoadingMessages(true);
    setMessageError("");

    try {
      const response = await fetch(`/api/messages/${friendshipId}?limit=50`, {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as FriendshipMessagesApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load chat history.");
      }

      setMessagesByFriendship((previous) => ({
        ...previous,
        [friendshipId]: payload.messages ?? [],
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load chat history.";
      setMessageError(message);
    } finally {
      setIsLoadingMessages(false);
    }
  }

  useEffect(() => {
    void loadFriends({
      reason: "mount",
    });
  }, []);

  useEffect(() => {
    if (selectedFriendshipId) {
      void loadMessagesForFriendship(selectedFriendshipId);
    }
  }, [selectedFriendshipId]);

  async function handleSendMessage() {
    const text = draftMessage.trim();
    if (!selectedFriend || !text) {
      return;
    }

    setIsSendingMessage(true);
    setMessageError("");

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friendship_id: selectedFriend.friendship_id,
          body: text,
        }),
      });

      const payload = (await response.json()) as SendMessageApiResponse;
      if (!response.ok || !payload.success || !payload.direct_message) {
        throw new Error(payload.message ?? "Unable to send message right now.");
      }
      const directMessage = payload.direct_message;

      setMessagesByFriendship((previous) => {
        const currentMessages = previous[selectedFriend.friendship_id] ?? [];
        return {
          ...previous,
          [selectedFriend.friendship_id]: [...currentMessages, directMessage],
        };
      });
      setDraftMessage("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to send message right now.";
      setMessageError(message);
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function loadFriendProfile(friendUserId: string) {
    const cached = friendProfiles[friendUserId];
    if (cached) {
      return cached;
    }

    const response = await fetch(`/api/friends/${friendUserId}/profile`, {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json()) as FriendProfileApiResponse;
    if (!response.ok || !payload.success || !payload.profile) {
      throw new Error(payload.message ?? "Unable to load friend profile right now.");
    }

    setFriendProfiles((previous) => ({
      ...previous,
      [friendUserId]: payload.profile as FriendProfile,
    }));
    return payload.profile as FriendProfile;
  }

  async function handleOpenProfile() {
    if (!selectedFriend) {
      return;
    }

    setIsProfileModalOpen(true);
    setIsLoadingProfile(true);
    setProfileError("");
    setSelectedProfile(null);

    try {
      const profile = await loadFriendProfile(selectedFriend.user_id);
      setSelectedProfile(profile);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load friend profile right now.";
      setProfileError(message);
    } finally {
      setIsLoadingProfile(false);
    }
  }

  async function handleStudyTogether() {
    if (!selectedFriend || !selectedFriend.is_online) {
      return;
    }

    setIsSendingStudyInvitation(true);
    setStudyFeedback("");
    setStudyError("");

    try {
      const cachedProfile = friendProfiles[selectedFriend.user_id] ?? null;
      const learningFieldId = cachedProfile?.current_learning_field?.field_id ?? undefined;

      const response = await fetch("/api/study/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receiver_user_id: selectedFriend.user_id,
          learning_field_id: learningFieldId,
        }),
      });

      const payload = (await response.json()) as InviteStudyApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to send study invitation right now.");
      }

      setStudyFeedback(payload.message ?? "Study invitation sent.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send study invitation right now.";
      setStudyError(message);
    } finally {
      setIsSendingStudyInvitation(false);
    }
  }

  function openAddFriendModal() {
    setIsAddFriendModalOpen(true);
    setSearchUsername("");
    setSearchError("");
    setSearchResult(null);
    setHasSearched(false);
  }

  function closeAddFriendModal() {
    if (isSearching) {
      return;
    }
    setIsAddFriendModalOpen(false);
  }

  async function handleSearchFriend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchError("");
    setRequestFeedback("");
    setRequestError("");
    setSelectedSearchUser(null);

    const username = searchUsername.trim();
    if (!username) {
      setSearchError("Please enter a username to search.");
      return;
    }

    setIsSearching(true);
    setHasSearched(true);

    try {
      const response = await fetch(
        `/api/friends/search?username=${encodeURIComponent(username)}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const payload = (await response.json()) as FriendSearchApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to search users right now.");
      }

      setSearchResult(payload.user ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to search users right now.";
      setSearchError(message);
      setSearchResult(null);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSendFriendRequest() {
    if (!selectedSearchUser) {
      return;
    }

    setIsSendingRequest(true);
    setRequestError("");
    setRequestFeedback("");

    try {
      const response = await fetch("/api/friends/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target_user_id: selectedSearchUser.id,
        }),
      });

      const payload = (await response.json()) as SendFriendRequestApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to send friend request right now.");
      }

      setRequestFeedback("Friend request sent.");
      setSelectedSearchUser((previous) =>
        previous
          ? {
              ...previous,
              existing_friendship_status: "pending",
            }
          : previous,
      );
      setSearchResult((previous) =>
        previous
          ? {
              ...previous,
              existing_friendship_status: "pending",
            }
          : previous,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to send friend request right now.";
      setRequestError(message);
    } finally {
      setIsSendingRequest(false);
    }
  }

  const relationshipLabel = getRelationshipLabel(
    selectedSearchUser?.existing_friendship_status ?? null,
  );
  const disableSendRequest = Boolean(relationshipLabel);

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-extrabold text-[#1F2937]">My Friends</h2>
          <p className="text-sm font-semibold text-[#1F2937]/70">
            Chat, compare progress, and keep each other motivated.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void loadFriends({
                reason: "manual_refresh",
              });
            }}
            className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-5 !text-sm !text-[#1F2937]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={openAddFriendModal}
            className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-base !text-[#1F2937]"
          >
            Add Friend
          </button>
        </div>
      </div>

      {friendsError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {friendsError}
        </p>
      ) : null}
      {messageError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {messageError}
        </p>
      ) : null}
      {studyFeedback ? (
        <p className="mt-4 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
          {studyFeedback}
        </p>
      ) : null}
      {studyError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {studyError}
        </p>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="rounded-3xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-3">
          {isLoadingFriends ? (
            <p className="rounded-2xl bg-white px-3 py-4 text-sm font-semibold text-[#1F2937]/70">
              Loading friends...
            </p>
          ) : friends.length === 0 ? (
            <p className="rounded-2xl bg-white px-3 py-4 text-sm font-semibold text-[#1F2937]/70">
              No accepted friends yet.
            </p>
          ) : (
            <div className="space-y-2">
              {friends.map((friend) => {
                const isActive = selectedFriendshipId === friend.friendship_id;
                return (
                  <button
                    key={friend.friendship_id}
                    type="button"
                    onClick={() => setSelectedFriendshipId(friend.friendship_id)}
                    className={`w-full rounded-2xl border-2 px-3 py-3 text-left transition ${
                      isActive
                        ? "border-[#1F2937] bg-[#58CC02]/15 shadow-[0_4px_0_#1f2937]"
                        : "border-[#1F2937]/12 bg-white hover:border-[#58CC02]/40 hover:bg-[#58CC02]/8"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-xs font-extrabold text-[#1F2937]">
                        {toInitial(friend.username)}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                            friend.is_online ? "bg-[#58CC02]" : "bg-zinc-400"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-[#1F2937]">
                          {friend.username}
                        </p>
                        <p className="truncate text-xs font-semibold text-[#1F2937]/65">
                          {friend.current_learning_field_title ?? "No active learning field"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          {isLoadingMessages && selectedFriend ? (
            <div className="mb-3 rounded-2xl bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
              Loading chat history...
            </div>
          ) : null}
          <FriendChatPanel
            currentUserId={currentUserId}
            friend={selectedFriend}
            messages={selectedMessages}
            draftMessage={draftMessage}
            onDraftChange={setDraftMessage}
            onSendMessage={handleSendMessage}
            onOpenProfile={() => {
              void handleOpenProfile();
            }}
            onStudyTogether={() => {
              void handleStudyTogether();
            }}
            isSendingMessage={isSendingMessage}
            isSendingStudyInvitation={isSendingStudyInvitation}
          />
        </div>
      </div>

      {isProfileModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-xl rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            {isLoadingProfile ? (
              <p className="text-sm font-semibold text-[#1F2937]/70">Loading profile...</p>
            ) : profileError ? (
              <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {profileError}
              </p>
            ) : selectedProfile ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-base font-extrabold text-[#1F2937]">
                      {toInitial(selectedProfile.username)}
                    </div>
                    <div>
                      <h3 className="text-2xl font-extrabold text-[#1F2937]">
                        {selectedProfile.username}
                      </h3>
                      <p className="text-sm font-semibold text-[#1F2937]/70">
                        {selectedProfile.current_learning_field?.title ?? "No active learning field"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                      selectedProfile.is_online
                        ? "bg-[#58CC02] text-white"
                        : "bg-[#1F2937]/10 text-[#1F2937]/70"
                    }`}
                  >
                    {selectedProfile.is_online ? "Online" : "Offline"}
                  </span>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                      Age
                    </p>
                    <p className="mt-2 text-base font-extrabold text-[#1F2937]">
                      {selectedProfile.age ?? "Not set"}
                    </p>
                  </article>
                  <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#FFF9DD] p-4">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                      Motto
                    </p>
                    <p className="mt-2 text-base font-semibold text-[#1F2937]">
                      {selectedProfile.motto?.trim() || "No motto right now."}
                    </p>
                  </article>
                </div>

                <div className="mt-3 rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
                  <p className="text-sm font-semibold text-[#1F2937]/72">
                    Current Level:{" "}
                    <span className="font-extrabold text-[#1F2937]">
                      {selectedProfile.current_level ?? "Not set"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#1F2937]/72">
                    Target Level:{" "}
                    <span className="font-extrabold text-[#1F2937]">
                      {selectedProfile.target_level ?? "Not set"}
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#1F2937]/72">
                    Progress:{" "}
                    <span className="font-extrabold text-[#1F2937]">
                      {selectedProfile.progress_summary?.percentage_progress ?? 0}%
                    </span>
                  </p>
                </div>
              </>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsProfileModalOpen(false);
                  setSelectedProfile(null);
                  setProfileError("");
                }}
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-[#1F2937]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddFriendModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-xl rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <h3 className="text-2xl font-extrabold text-[#1F2937]">Add Friend</h3>
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
              Search by username and send a friend request.
            </p>

            <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={handleSearchFriend}>
              <input
                type="text"
                value={searchUsername}
                onChange={(event) => setSearchUsername(event.target.value)}
                placeholder="Enter username"
                className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="btn-3d btn-3d-green inline-flex h-12 shrink-0 items-center justify-center px-6 !text-base disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSearching ? "Searching..." : "Search"}
              </button>
            </form>

            {searchError ? (
              <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {searchError}
              </p>
            ) : null}

            {hasSearched && !isSearching && !searchResult && !searchError ? (
              <article className="mt-4 rounded-2xl border-2 border-dashed border-[#1F2937]/15 bg-[#F8FCFF] p-4">
                <p className="text-sm font-extrabold text-[#1F2937]">User not found.</p>
                <p className="mt-1 text-sm font-semibold text-[#1F2937]/65">
                  Try another exact username.
                </p>
              </article>
            ) : null}

            {searchResult ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedSearchUser(searchResult);
                  setRequestFeedback("");
                  setRequestError("");
                }}
                className="mt-4 w-full rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4 text-left transition hover:border-[#58CC02]/45 hover:bg-[#F0FFE3]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-sm font-extrabold text-[#1F2937]">
                    {toInitial(searchResult.username)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-extrabold text-[#1F2937]">
                      {searchResult.username}
                    </p>
                    <p className="truncate text-xs font-semibold text-[#1F2937]/65">
                      {searchResult.current_learning_field_title ?? "No active learning field"}
                    </p>
                  </div>
                </div>
              </button>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeAddFriendModal}
                disabled={isSearching}
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedSearchUser ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-xl rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-base font-extrabold text-[#1F2937]">
                  {toInitial(selectedSearchUser.username)}
                </div>
                <div>
                  <h3 className="text-2xl font-extrabold text-[#1F2937]">
                    {selectedSearchUser.username}
                  </h3>
                  <p className="text-sm font-semibold text-[#1F2937]/70">
                    {selectedSearchUser.current_learning_field_title ?? "No active learning field"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  void handleSendFriendRequest();
                }}
                disabled={isSendingRequest || disableSendRequest}
                className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center px-6 !text-base disabled:cursor-not-allowed disabled:opacity-70"
              >
                {disableSendRequest
                  ? relationshipLabel
                  : isSendingRequest
                    ? "Sending..."
                    : "Friend Request"}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Age
                </p>
                <p className="mt-2 text-base font-extrabold text-[#1F2937]">
                  {selectedSearchUser.age ?? "Not set"}
                </p>
              </article>
              <article className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#FFF9DD] p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                  Motto
                </p>
                <p className="mt-2 text-base font-semibold text-[#1F2937]">
                  {selectedSearchUser.motto?.trim() || "No motto right now."}
                </p>
              </article>
            </div>

            {requestFeedback ? (
              <p className="mt-4 rounded-xl bg-[#f1fff1] px-3 py-2 text-sm font-semibold text-[#2e7d32]">
                {requestFeedback}
              </p>
            ) : null}
            {requestError ? (
              <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {requestError}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedSearchUser(null)}
                disabled={isSendingRequest}
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
