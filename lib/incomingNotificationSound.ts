import { areSoundEffectsEnabled, playSound } from "@/lib/sound";

export type IncomingNotificationType =
  | "direct_message"
  | "official_message"
  | "study_room_invitation"
  | "friend_request"
  | "messages_summary"
  | "other";

type IncomingNotificationSoundParams = {
  type: IncomingNotificationType;
  eventId?: string | null;
  isIncoming: boolean;
  isInitialLoad?: boolean;
  isDuplicate?: boolean;
  currentUserId?: string | null;
  receiverId?: string | null;
  source: string;
  suppressIfPlayedWithinMs?: number;
};

const PLAYED_EVENT_KEY_TTL_MS = 5 * 60 * 1000;
const playedEventKeys = new Map<string, number>();
let lastNotificationSoundAt = 0;

function cleanupExpiredEventKeys(now: number) {
  for (const [key, timestamp] of playedEventKeys.entries()) {
    if (now - timestamp > PLAYED_EVENT_KEY_TTL_MS) {
      playedEventKeys.delete(key);
    }
  }
}

export function shouldPlayIncomingNotificationSound(
  params: IncomingNotificationSoundParams,
) {
  const currentUserId = params.currentUserId?.trim() ?? "";
  const receiverId = params.receiverId?.trim() ?? "";

  if (!params.isIncoming) {
    return {
      allowed: false,
      reason: "not_incoming",
    } as const;
  }

  if (params.isInitialLoad) {
    return {
      allowed: false,
      reason: "initial_load",
    } as const;
  }

  if (params.isDuplicate) {
    return {
      allowed: false,
      reason: "duplicate_event",
    } as const;
  }

  if (receiverId && currentUserId && receiverId !== currentUserId) {
    return {
      allowed: false,
      reason: "receiver_mismatch",
    } as const;
  }

  if (!areSoundEffectsEnabled()) {
    return {
      allowed: false,
      reason: "sound_disabled",
    } as const;
  }

  const normalizedEventId = params.eventId?.trim() ?? "";
  const dedupeKey = normalizedEventId ? `${params.type}:${normalizedEventId}` : "";
  const now = Date.now();
  cleanupExpiredEventKeys(now);

  if (dedupeKey && playedEventKeys.has(dedupeKey)) {
    return {
      allowed: false,
      reason: "already_played",
    } as const;
  }

  const suppressWindowMs = params.suppressIfPlayedWithinMs ?? 0;
  if (suppressWindowMs > 0 && now - lastNotificationSoundAt < suppressWindowMs) {
    return {
      allowed: false,
      reason: "cooldown",
    } as const;
  }

  return {
    allowed: true,
    reason: "ok",
    dedupeKey,
  } as const;
}

export function playIncomingNotificationSound(
  params: IncomingNotificationSoundParams,
) {
  const decision = shouldPlayIncomingNotificationSound(params);
  const eventId = params.eventId?.trim() ?? null;

  if (!decision.allowed) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[incoming_notification_sound] skipped", {
        type: params.type,
        event_id: eventId,
        source: params.source,
        reason: decision.reason,
        is_incoming: params.isIncoming,
        is_initial_load: params.isInitialLoad ?? false,
        is_duplicate: params.isDuplicate ?? false,
        sound_enabled: areSoundEffectsEnabled(),
      });
    }
    return false;
  }

  const now = Date.now();
  if (decision.dedupeKey) {
    playedEventKeys.set(decision.dedupeKey, now);
  }
  lastNotificationSoundAt = now;

  playSound("notification");

  if (process.env.NODE_ENV !== "production") {
    console.info("[incoming_notification_sound] played", {
      type: params.type,
      event_id: eventId,
      source: params.source,
      dedupe_key: decision.dedupeKey || null,
    });
  }
  return true;
}
