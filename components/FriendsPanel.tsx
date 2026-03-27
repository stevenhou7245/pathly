"use client";

import AvatarPreviewModal from "@/components/AvatarPreviewModal";
import FriendChatPanel from "@/components/FriendChatPanel";
import { mapDirectRealtimeMessage } from "@/lib/chatRealtime";
import { playIncomingNotificationSound } from "@/lib/incomingNotificationSound";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type FriendListItem = {
  friendship_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
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
  avatar_path: string | null;
  avatar_updated_at: string | null;
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
  avatar_path: string | null;
  avatar_updated_at: string | null;
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

function toNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function appendMessageUnique(
  previous: MessageStore,
  friendshipId: string,
  message: DirectMessageItem,
) {
  const currentMessages = previous[friendshipId] ?? [];
  if (currentMessages.some((item) => item.id === message.id)) {
    return previous;
  }
  return {
    ...previous,
    [friendshipId]: [...currentMessages, message].sort((a, b) =>
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    ),
  };
}

function applyAvatarPatch<
  T extends {
    avatar_url: string | null;
    avatar_path: string | null;
    avatar_updated_at: string | null;
  },
>(
  current: T,
  patch: {
    avatar_url: string | null;
    avatar_path: string | null;
    avatar_updated_at: string | null;
  },
) {
  if (
    current.avatar_url === patch.avatar_url &&
    current.avatar_path === patch.avatar_path &&
    current.avatar_updated_at === patch.avatar_updated_at
  ) {
    return current;
  }
  return {
    ...current,
    avatar_url: patch.avatar_url,
    avatar_path: patch.avatar_path,
    avatar_updated_at: patch.avatar_updated_at,
  };
}

type FriendsPanelProps = {
  onMessagesUpdated?: () => void;
};

export default function FriendsPanel({ onMessagesUpdated }: FriendsPanelProps) {
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
  const [unreadByFriendship, setUnreadByFriendship] = useState<Record<string, number>>({});

  const [friendProfiles, setFriendProfiles] = useState<ProfileStore>({});
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<FriendProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

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
  const [avatarPreview, setAvatarPreview] = useState<{
    avatarUrl: string | null;
    fallbackInitial: string;
    displayName: string;
  } | null>(null);
  const latestLoadRequestIdRef = useRef(0);
  const fetchCountRef = useRef(0);
  const currentUserIdRef = useRef("");
  const selectedFriendshipIdRef = useRef("");
  const isMountedRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

  const selectedFriend = useMemo(
    () => friends.find((friend) => friend.friendship_id === selectedFriendshipId) ?? null,
    [friends, selectedFriendshipId],
  );

  const selectedMessages = useMemo(
    () => (selectedFriend ? messagesByFriendship[selectedFriend.friendship_id] ?? [] : []),
    [messagesByFriendship, selectedFriend],
  );
  const friendByFriendshipId = useMemo(
    () => new Map(friends.map((friend) => [friend.friendship_id, friend] as const)),
    [friends],
  );
  const watchedAvatarUserIds = useMemo(() => {
    const ids = new Set<string>();
    friends.forEach((friend) => {
      if (friend.user_id) {
        ids.add(friend.user_id);
      }
    });
    if (searchResult?.id) {
      ids.add(searchResult.id);
    }
    if (selectedSearchUser?.id) {
      ids.add(selectedSearchUser.id);
    }
    if (selectedProfile?.user_id) {
      ids.add(selectedProfile.user_id);
    }
    Object.values(friendProfiles).forEach((profile) => {
      if (profile?.user_id) {
        ids.add(profile.user_id);
      }
    });
    return Array.from(ids);
  }, [friendProfiles, friends, searchResult?.id, selectedProfile?.user_id, selectedSearchUser?.id]);

  function openAvatarPreview(params: {
    avatarUrl: string | null;
    fallbackInitial: string;
    displayName: string;
  }) {
    setAvatarPreview(params);
  }

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    selectedFriendshipIdRef.current = selectedFriendshipId;
  }, [selectedFriendshipId]);

  useEffect(() => {
    const validIds = new Set(friends.map((friend) => friend.friendship_id));
    setUnreadByFriendship((previous) => {
      const nextEntries = Object.entries(previous).filter(([friendshipId]) =>
        validIds.has(friendshipId),
      );
      if (nextEntries.length === Object.keys(previous).length) {
        return previous;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [friends]);

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

      const nextFriends = (result.payload.friends ?? [])
        .filter((friend) => friend.friendship_status === "accepted")
        .map((friend) => ({
          ...friend,
          avatar_url: friend.avatar_url ?? null,
          avatar_path: friend.avatar_path ?? null,
          avatar_updated_at: friend.avatar_updated_at ?? null,
        }));
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

  const markMessagesAsRead = useCallback(async (friendshipId: string) => {
    if (!friendshipId || !currentUserIdRef.current) {
      return;
    }

    try {
      await fetch("/api/messages/read", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friendship_id: friendshipId,
        }),
      });
    } catch {
      // Keep local state stable even if read-sync request fails.
    }

    setMessagesByFriendship((previous) => {
      const currentMessages = previous[friendshipId];
      if (!currentMessages || currentMessages.length === 0) {
        return previous;
      }
      return {
        ...previous,
        [friendshipId]: currentMessages.map((message) =>
          message.sender_id !== currentUserIdRef.current
            ? {
                ...message,
                is_read: true,
              }
            : message,
        ),
      };
    });
    setUnreadByFriendship((previous) => ({
      ...previous,
      [friendshipId]: 0,
    }));
    onMessagesUpdated?.();
  }, [onMessagesUpdated]);

  const loadMessagesForFriendship = useCallback(async (friendshipId: string) => {
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
      const nextMessages = payload.messages ?? [];
      nextMessages.forEach((message) => {
        if (message.id) {
          seenMessageIdsRef.current.add(message.id);
        }
      });
      const unreadCount = nextMessages.filter(
        (message) =>
          !message.is_read &&
          message.sender_id !== currentUserIdRef.current &&
          message.friendship_id === friendshipId,
      ).length;

      setMessagesByFriendship((previous) => ({
        ...previous,
        [friendshipId]: nextMessages,
      }));
      setUnreadByFriendship((previous) => ({
        ...previous,
        [friendshipId]: unreadCount,
      }));
      onMessagesUpdated?.();

      if (unreadCount > 0) {
        void markMessagesAsRead(friendshipId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load chat history.";
      setMessageError(message);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [markMessagesAsRead, onMessagesUpdated]);

  useEffect(() => {
    void loadFriends({
      reason: "mount",
    });
  }, []);

  useEffect(() => {
    if (selectedFriendshipId) {
      void loadMessagesForFriendship(selectedFriendshipId);
    }
  }, [loadMessagesForFriendship, selectedFriendshipId]);

  useEffect(() => {
    const friendshipIds = Array.from(friendByFriendshipId.keys()).filter(Boolean);
    if (!currentUserId || friendshipIds.length === 0) {
      return;
    }

    const friendshipIdSet = new Set(friendshipIds);
    let active = true;
    let supabaseClient: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try {
      supabaseClient = getSupabaseBrowserClient();
    } catch (error) {
      console.warn("[direct_messages_realtime] client_init_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const channel = supabaseClient
      .channel(`direct-messages:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
        },
        (payload) => {
          if (!active) {
            return;
          }
          const mapped = mapDirectRealtimeMessage(payload.new);
          if (!mapped.id || !mapped.friendship_id) {
            return;
          }
          if (!friendshipIdSet.has(mapped.friendship_id)) {
            return;
          }
          if (seenMessageIdsRef.current.has(mapped.id)) {
            return;
          }
          seenMessageIdsRef.current.add(mapped.id);

          const friendship = friendByFriendshipId.get(mapped.friendship_id);
          if (!friendship) {
            return;
          }
          if (mapped.sender_id !== currentUserId && mapped.sender_id !== friendship.user_id) {
            console.warn("[direct_messages_realtime] unauthorized_sender_ignored", {
              friendship_id: mapped.friendship_id,
              sender_id: mapped.sender_id,
              expected_user_ids: [currentUserId, friendship.user_id],
            });
            return;
          }
          const isIncoming = mapped.sender_id !== currentUserId;
          const isActiveConversation = selectedFriendshipIdRef.current === mapped.friendship_id;

          console.info("[direct_messages_realtime] message_received", {
            conversation_id: mapped.conversation_id,
            friendship_id: mapped.friendship_id,
            sender_id: mapped.sender_id,
            message_id: mapped.id,
            incoming: isIncoming,
            active_conversation: isActiveConversation,
          });

          setMessagesByFriendship((previous) =>
            appendMessageUnique(previous, mapped.friendship_id, {
              id: mapped.id,
              friendship_id: mapped.friendship_id,
              sender_id: mapped.sender_id,
              body: mapped.body,
              is_read: isIncoming && isActiveConversation ? true : mapped.is_read,
              created_at: mapped.created_at,
            }),
          );

          if (!isIncoming) {
            return;
          }

          playIncomingNotificationSound({
            type: "direct_message",
            eventId: mapped.id,
            isIncoming,
            currentUserId,
            receiverId: currentUserId,
            source: "friends_panel:direct_messages_realtime",
          });
          if (isActiveConversation) {
            void markMessagesAsRead(mapped.friendship_id);
            return;
          }
          setUnreadByFriendship((previous) => ({
            ...previous,
            [mapped.friendship_id]: (previous[mapped.friendship_id] ?? 0) + 1,
          }));
          onMessagesUpdated?.();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.info("[direct_messages_realtime] subscription_succeeded", {
            conversation_id: "all_friendships",
            friendship_count: friendshipIds.length,
          });
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[direct_messages_realtime] subscription_failed", {
            conversation_id: "all_friendships",
            status,
          });
        }
      });

    return () => {
      active = false;
      console.info("[direct_messages_realtime] subscription_cleanup", {
        conversation_id: "all_friendships",
      });
      void channel.unsubscribe();
      if (supabaseClient) {
        void supabaseClient.removeChannel(channel);
      }
    };
  }, [currentUserId, friendByFriendshipId, markMessagesAsRead, onMessagesUpdated]);

  useEffect(() => {
    if (watchedAvatarUserIds.length === 0) {
      return;
    }

    let active = true;
    let supabaseClient: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try {
      supabaseClient = getSupabaseBrowserClient();
    } catch (error) {
      console.warn("[friends_avatar_realtime] client_init_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const watchedUserIdSet = new Set(watchedAvatarUserIds);
    const channel = supabaseClient
      .channel(`friends-avatar-updates:${currentUserId || "anonymous"}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "users",
        },
        (payload) => {
          if (!active) {
            return;
          }
          const row = (payload.new ?? {}) as Record<string, unknown>;
          const updatedUserId = typeof row.id === "string" ? row.id : "";
          if (!updatedUserId || !watchedUserIdSet.has(updatedUserId)) {
            return;
          }

          const patch = {
            avatar_url: toNullableString(row.avatar_url),
            avatar_path: toNullableString(row.avatar_path),
            avatar_updated_at: toNullableString(row.avatar_updated_at),
          };

          if (process.env.NODE_ENV !== "production") {
            console.info("[friends_avatar_realtime] avatar_updated", {
              user_id: updatedUserId,
              avatar_updated_at: patch.avatar_updated_at,
            });
          }

          setFriends((previous) => {
            let changed = false;
            const next = previous.map((friend) => {
              if (friend.user_id !== updatedUserId) {
                return friend;
              }
              const patched = applyAvatarPatch(friend, patch);
              if (patched !== friend) {
                changed = true;
              }
              return patched;
            });
            return changed ? next : previous;
          });

          setSearchResult((previous) => {
            if (!previous || previous.id !== updatedUserId) {
              return previous;
            }
            return applyAvatarPatch(previous, patch);
          });
          setSelectedSearchUser((previous) => {
            if (!previous || previous.id !== updatedUserId) {
              return previous;
            }
            return applyAvatarPatch(previous, patch);
          });
          setSelectedProfile((previous) => {
            if (!previous || previous.user_id !== updatedUserId) {
              return previous;
            }
            return applyAvatarPatch(previous, patch);
          });
          setFriendProfiles((previous) => {
            let changed = false;
            const next: ProfileStore = {};
            Object.entries(previous).forEach(([key, profile]) => {
              if (profile.user_id !== updatedUserId) {
                next[key] = profile;
                return;
              }
              const patched = applyAvatarPatch(profile, patch);
              next[key] = patched;
              if (patched !== profile) {
                changed = true;
              }
            });
            return changed ? next : previous;
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (process.env.NODE_ENV !== "production") {
            console.info("[friends_avatar_realtime] subscription_succeeded", {
              watched_users: watchedAvatarUserIds.length,
            });
          }
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[friends_avatar_realtime] subscription_failed", {
            status,
            watched_users: watchedAvatarUserIds.length,
          });
        }
      });

    return () => {
      active = false;
      if (process.env.NODE_ENV !== "production") {
        console.info("[friends_avatar_realtime] subscription_cleanup", {
          watched_users: watchedAvatarUserIds.length,
        });
      }
      void channel.unsubscribe();
      if (supabaseClient) {
        void supabaseClient.removeChannel(channel);
      }
    };
  }, [currentUserId, watchedAvatarUserIds]);

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
      if (directMessage.id) {
        seenMessageIdsRef.current.add(directMessage.id);
      }

      console.info("[direct_messages] send_succeeded", {
        conversation_id: selectedFriend.friendship_id,
        message_id: directMessage.id,
        sender_id: directMessage.sender_id,
      });

      setMessagesByFriendship((previous) => {
        return appendMessageUnique(previous, selectedFriend.friendship_id, directMessage);
      });
      setDraftMessage("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to send message right now.";
      console.error("[direct_messages] send_failed", {
        conversation_id: selectedFriend.friendship_id,
        reason: message,
      });
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

    const normalizedProfile: FriendProfile = {
      ...payload.profile,
      avatar_url: payload.profile.avatar_url ?? null,
      avatar_path: payload.profile.avatar_path ?? null,
      avatar_updated_at: payload.profile.avatar_updated_at ?? null,
    };
    setFriendProfiles((previous) => ({
      ...previous,
      [friendUserId]: normalizedProfile,
    }));
    return normalizedProfile;
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

      setSearchResult(
        payload.user
          ? {
              ...payload.user,
              avatar_url: payload.user.avatar_url ?? null,
              avatar_path: payload.user.avatar_path ?? null,
              avatar_updated_at: payload.user.avatar_updated_at ?? null,
            }
          : null,
      );
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
            className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-5 !text-base"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={openAddFriendModal}
            className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-base"
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
                const unreadCount = unreadByFriendship[friend.friendship_id] ?? 0;
                return (
                  <div
                    key={friend.friendship_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedFriendshipId(friend.friendship_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedFriendshipId(friend.friendship_id);
                      }
                    }}
                    className={`w-full rounded-2xl border-2 px-3 py-3 text-left transition ${
                      isActive
                        ? "border-[#1F2937] bg-[#58CC02]/15 shadow-[0_4px_0_#1f2937]"
                        : "border-[#1F2937]/12 bg-white hover:border-[#58CC02]/40 hover:bg-[#58CC02]/8"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openAvatarPreview({
                            avatarUrl: friend.avatar_url,
                            fallbackInitial: toInitial(friend.username),
                            displayName: friend.username,
                          });
                        }}
                        className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-xs font-extrabold text-[#1F2937] transition hover:scale-[1.02]"
                        aria-label={`Preview ${friend.username} avatar`}
                      >
                        {friend.avatar_url ? (
                          <img
                            src={friend.avatar_url}
                            alt={`${friend.username} avatar`}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          toInitial(friend.username)
                        )}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                            friend.is_online ? "bg-[#58CC02]" : "bg-zinc-400"
                          }`}
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-extrabold text-[#1F2937]">
                            {friend.username}
                          </p>
                          {unreadCount > 0 ? (
                            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#58CC02] px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white">
                              {unreadCount}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs font-semibold text-[#1F2937]/65">
                          {friend.current_learning_field_title ?? "No active learning field"}
                        </p>
                      </div>
                    </div>
                  </div>
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
            isSendingMessage={isSendingMessage}
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
                    <button
                      type="button"
                      onClick={() =>
                        openAvatarPreview({
                          avatarUrl: selectedProfile.avatar_url,
                          fallbackInitial: toInitial(selectedProfile.username),
                          displayName: selectedProfile.username,
                        })
                      }
                      className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-base font-extrabold text-[#1F2937] transition hover:scale-[1.02]"
                      aria-label={`Preview ${selectedProfile.username} avatar`}
                    >
                      {selectedProfile.avatar_url ? (
                        <img
                          src={selectedProfile.avatar_url}
                          alt={`${selectedProfile.username} avatar`}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        toInitial(selectedProfile.username)
                      )}
                    </button>
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
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6"
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
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedSearchUser(searchResult);
                  setRequestFeedback("");
                  setRequestError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedSearchUser(searchResult);
                    setRequestFeedback("");
                    setRequestError("");
                  }
                }}
                className="mt-4 w-full rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4 text-left transition hover:border-[#58CC02]/45 hover:bg-[#F0FFE3]"
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openAvatarPreview({
                        avatarUrl: searchResult.avatar_url,
                        fallbackInitial: toInitial(searchResult.username),
                        displayName: searchResult.username,
                      });
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-sm font-extrabold text-[#1F2937] transition hover:scale-[1.02]"
                    aria-label={`Preview ${searchResult.username} avatar`}
                  >
                    {searchResult.avatar_url ? (
                      <img
                        src={searchResult.avatar_url}
                        alt={`${searchResult.username} avatar`}
                        className="h-11 w-11 rounded-full object-cover"
                      />
                    ) : (
                      toInitial(searchResult.username)
                    )}
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-base font-extrabold text-[#1F2937]">
                      {searchResult.username}
                    </p>
                    <p className="truncate text-xs font-semibold text-[#1F2937]/65">
                      {searchResult.current_learning_field_title ?? "No active learning field"}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeAddFriendModal}
                disabled={isSearching}
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
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
                <button
                  type="button"
                  onClick={() =>
                    openAvatarPreview({
                      avatarUrl: selectedSearchUser.avatar_url,
                      fallbackInitial: toInitial(selectedSearchUser.username),
                      displayName: selectedSearchUser.username,
                    })
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] text-base font-extrabold text-[#1F2937] transition hover:scale-[1.02]"
                  aria-label={`Preview ${selectedSearchUser.username} avatar`}
                >
                  {selectedSearchUser.avatar_url ? (
                    <img
                      src={selectedSearchUser.avatar_url}
                      alt={`${selectedSearchUser.username} avatar`}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    toInitial(selectedSearchUser.username)
                  )}
                </button>
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
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Close
              </button>
            </div>
          </div>
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

