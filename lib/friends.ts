import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type FriendshipStatus = "pending" | "accepted" | "declined";

export type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string | null;
};

type UserBasicRecord = {
  id: string;
  username: string;
};

type UserProfileRecord = {
  user_id: string;
  avatar_url: string | null;
  bio: string | null;
  age: number | null;
  motto: string | null;
  is_online: boolean | null;
  last_seen_at: string | null;
};

type UserLearningFieldRecord = {
  id: string;
  user_id: string;
  field_id: string;
  current_level: string | null;
  target_level: string | null;
  timestamp: string | null;
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function toIsoDate(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getFieldTitle(field: GenericRecord | undefined) {
  if (!field) {
    return null;
  }
  const title = toStringValue(field.title);
  if (title) {
    return title;
  }
  const name = toStringValue(field.name);
  if (name) {
    return name;
  }
  return null;
}

function normalizeFriendshipRow(row: GenericRecord): FriendshipRow {
  return {
    id: toStringValue(row.id),
    requester_id: toStringValue(row.requester_id),
    addressee_id: toStringValue(row.addressee_id),
    status: (toStringValue(row.status) || "pending") as FriendshipStatus,
    created_at: toNullableString(row.created_at),
  };
}

function normalizeLearningFieldRows(
  rows: GenericRecord[],
  timestampColumn: "created_at" | "started_at",
) {
  return rows.map((row) => ({
    id: toStringValue(row.id),
    user_id: toStringValue(row.user_id),
    field_id: toStringValue(row.field_id),
    current_level: toNullableString(row.current_level),
    target_level: toNullableString(row.target_level),
    timestamp: toNullableString(row[timestampColumn]),
  }));
}

async function loadProfilesByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return [] as UserProfileRecord[];
  }

  const withPresence = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, avatar_url, bio, age, motto, is_online, last_seen_at")
    .in("user_id", userIds);

  if (!withPresence.error) {
    return ((withPresence.data ?? []) as GenericRecord[]).map((row) => ({
      user_id: toStringValue(row.user_id),
      avatar_url: toNullableString(row.avatar_url),
      bio: toNullableString(row.bio),
      age: toNullableNumber(row.age),
      motto: toNullableString(row.motto),
      is_online: toBoolean(row.is_online),
      last_seen_at: toNullableString(row.last_seen_at),
    }));
  }

  if (!/is_online|last_seen_at/i.test(withPresence.error.message)) {
    throw new Error("Failed to load user profile data.");
  }

  const fallback = await supabaseAdmin
    .from("user_profiles")
    .select("user_id, avatar_url, bio, age, motto")
    .in("user_id", userIds);

  if (fallback.error) {
    throw new Error("Failed to load user profile data.");
  }

  return ((fallback.data ?? []) as GenericRecord[]).map((row) => ({
    user_id: toStringValue(row.user_id),
    avatar_url: toNullableString(row.avatar_url),
    bio: toNullableString(row.bio),
    age: toNullableNumber(row.age),
    motto: toNullableString(row.motto),
    is_online: false,
    last_seen_at: null,
  }));
}

async function loadUserLearningFieldRowsByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return [] as UserLearningFieldRecord[];
  }

  const withCreatedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, user_id, field_id, current_level, target_level, created_at")
    .in("user_id", userIds);

  if (!withCreatedAt.error) {
    return normalizeLearningFieldRows(
      (withCreatedAt.data ?? []) as GenericRecord[],
      "created_at",
    );
  }

  if (!/created_at/i.test(withCreatedAt.error.message)) {
    throw new Error("Failed to load user learning fields.");
  }

  const withStartedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, user_id, field_id, current_level, target_level, started_at")
    .in("user_id", userIds);

  if (withStartedAt.error) {
    throw new Error("Failed to load user learning fields.");
  }

  return normalizeLearningFieldRows(
    (withStartedAt.data ?? []) as GenericRecord[],
    "started_at",
  );
}

function getLatestUserLearningFieldByUserId(rows: UserLearningFieldRecord[]) {
  const map = new Map<string, UserLearningFieldRecord>();

  rows.forEach((row) => {
    if (!row.user_id || !row.field_id) {
      return;
    }

    const previous = map.get(row.user_id);
    if (!previous) {
      map.set(row.user_id, row);
      return;
    }

    const previousTime = previous.timestamp ?? "";
    const currentTime = row.timestamp ?? "";
    if (currentTime > previousTime) {
      map.set(row.user_id, row);
    }
  });

  return map;
}

export async function ensureUserExists(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", userId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error("Failed to validate user.");
  }

  return Boolean(data);
}

export async function getFriendshipsForUser(userId: string): Promise<FriendshipRow[]> {
  const { data, error } = await supabaseAdmin
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  if (error) {
    throw new Error("Failed to load friendships.");
  }

  return (data ?? [])
    .map((row) => normalizeFriendshipRow(row as GenericRecord))
    .filter((row) => row.id && row.requester_id && row.addressee_id);
}

export async function getFriendshipBetweenUsers(
  userA: string,
  userB: string,
): Promise<FriendshipRow | null> {
  const [forwardResult, reverseResult] = await Promise.all([
    supabaseAdmin
      .from("friendships")
      .select("*")
      .eq("requester_id", userA)
      .eq("addressee_id", userB)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("friendships")
      .select("*")
      .eq("requester_id", userB)
      .eq("addressee_id", userA)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (forwardResult.error || reverseResult.error) {
    throw new Error("Failed to validate friendship.");
  }

  const rows = [forwardResult.data, reverseResult.data]
    .filter(Boolean)
    .map((row) => normalizeFriendshipRow(row as GenericRecord));

  if (rows.length === 0) {
    return null;
  }

  rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return rows[0];
}

export async function createFriendRequest(params: {
  requesterId: string;
  addresseeId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("friendships")
    .insert({
      requester_id: params.requesterId,
      addressee_id: params.addresseeId,
      status: "pending",
    })
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to create friend request.");
  }

  return normalizeFriendshipRow((data ?? {}) as GenericRecord);
}

export async function respondToFriendRequest(params: {
  friendshipId: string;
  action: "accepted" | "declined";
}) {
  const { data, error } = await supabaseAdmin
    .from("friendships")
    .update({
      status: params.action,
    })
    .eq("id", params.friendshipId)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to update friend request.");
  }

  return data ? normalizeFriendshipRow(data as GenericRecord) : null;
}

export async function getUsersBasicWithProfiles(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<
      string,
      {
        id: string;
        username: string;
        avatar_url: string | null;
        bio: string | null;
        age: number | null;
        motto: string | null;
        is_online: boolean;
        last_seen_at: string | null;
      }
    >();
  }

  const [usersResult, profiles] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id, username")
      .in("id", userIds),
    loadProfilesByUserIds(userIds),
  ]);

  if (usersResult.error) {
    throw new Error("Failed to load user profile data.");
  }

  const profileByUserId = new Map<string, UserProfileRecord>();
  profiles.forEach((profile) => {
    profileByUserId.set(profile.user_id, profile);
  });

  const map = new Map<
    string,
    {
      id: string;
      username: string;
      avatar_url: string | null;
      bio: string | null;
      age: number | null;
      motto: string | null;
      is_online: boolean;
      last_seen_at: string | null;
    }
  >();

  (usersResult.data ?? []).forEach((user) => {
    const typedUser = user as UserBasicRecord;
    const profile = profileByUserId.get(typedUser.id);
    map.set(typedUser.id, {
      id: typedUser.id,
      username: typedUser.username,
      avatar_url: profile?.avatar_url ?? null,
      bio: profile?.bio ?? null,
      age: profile?.age ?? null,
      motto: profile?.motto ?? null,
      is_online: profile?.is_online ?? false,
      last_seen_at: profile?.last_seen_at ?? null,
    });
  });

  return map;
}

export async function getCurrentLearningFieldTitleByUserIds(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, string | null>();
  }

  const userFields = await loadUserLearningFieldRowsByUserIds(userIds);
  const latestFieldByUser = getLatestUserLearningFieldByUserId(userFields);

  const fieldIds = Array.from(
    new Set(Array.from(latestFieldByUser.values()).map((item) => item.field_id)),
  ).filter(Boolean);

  if (fieldIds.length === 0) {
    return new Map<string, string | null>();
  }

  const { data: learningFields, error: learningFieldsError } = await supabaseAdmin
    .from("learning_fields")
    .select("*")
    .in("id", fieldIds);

  if (learningFieldsError) {
    throw new Error("Failed to load learning fields.");
  }

  const learningFieldMap = new Map<string, GenericRecord>();
  (learningFields ?? []).forEach((row) => {
    const record = row as GenericRecord;
    learningFieldMap.set(toStringValue(record.id), record);
  });

  const result = new Map<string, string | null>();
  latestFieldByUser.forEach((fieldRow, userId) => {
    result.set(userId, getFieldTitle(learningFieldMap.get(fieldRow.field_id)));
  });

  return result;
}

export async function getLatestLearningFieldForUser(userId: string) {
  const userFields = await loadUserLearningFieldRowsByUserIds([userId]);
  const latest = getLatestUserLearningFieldByUserId(userFields).get(userId);

  if (!latest) {
    return null;
  }

  const { data: field, error: fieldError } = await supabaseAdmin
    .from("learning_fields")
    .select("*")
    .eq("id", latest.field_id)
    .limit(1)
    .maybeSingle();

  if (fieldError) {
    throw new Error("Failed to load learning field.");
  }

  return {
    id: latest.id,
    field_id: latest.field_id,
    title: getFieldTitle((field ?? {}) as GenericRecord),
    current_level: latest.current_level,
    target_level: latest.target_level,
    created_at: latest.timestamp,
  };
}

export async function getProgressSummaryForField(params: {
  userId: string;
  fieldId: string;
}) {
  const { data: latestJourneyPath, error: latestJourneyPathError } = await supabaseAdmin
    .from("journey_paths")
    .select("id, total_steps")
    .eq("user_id", params.userId)
    .eq("learning_field_id", params.fieldId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestJourneyPathError) {
    throw new Error("Failed to load journey path.");
  }

  const journeyPathId = toStringValue((latestJourneyPath as GenericRecord | null)?.id);
  if (!journeyPathId) {
    return {
      completed_steps_count: 0,
      total_steps_count: 0,
      percentage_progress: 0,
    };
  }

  const { data: progressRows, error: progressRowsError } = await supabaseAdmin
    .from("user_course_progress")
    .select("course_id, status")
    .eq("user_id", params.userId)
    .eq("journey_path_id", journeyPathId);

  if (progressRowsError) {
    throw new Error("Failed to load course progress.");
  }

  const completedCount = new Set(
    ((progressRows ?? []) as GenericRecord[])
      .filter((row) => {
        const status = toStringValue(row.status).toLowerCase();
        return status === "passed" || status === "completed";
      })
      .map((row) => toStringValue(row.course_id))
      .filter(Boolean),
  ).size;

  const declaredTotalSteps = Math.max(
    0,
    Math.floor(toNullableNumber((latestJourneyPath as GenericRecord | null)?.total_steps) ?? 0),
  );
  const totalCount = Math.max(declaredTotalSteps, (progressRows ?? []).length);

  console.info("[journey_read] source_table_used", {
    table: "journey_paths",
    journey_path_id: journeyPathId,
  });

  return {
    completed_steps_count: completedCount,
    total_steps_count: totalCount,
    percentage_progress:
      totalCount === 0 ? 0 : Number(((completedCount / totalCount) * 100).toFixed(1)),
  };
}

export async function areUsersAcceptedFriends(params: {
  userId: string;
  friendId: string;
}) {
  const friendship = await getFriendshipBetweenUsers(params.userId, params.friendId);
  if (!friendship) {
    return false;
  }
  return friendship.status === "accepted";
}

export function getFriendUserIdFromFriendship(params: {
  friendship: FriendshipRow;
  currentUserId: string;
}) {
  if (params.friendship.requester_id === params.currentUserId) {
    return params.friendship.addressee_id;
  }
  return params.friendship.requester_id;
}

export function splitIncomingOutgoingPending(params: {
  friendships: FriendshipRow[];
  currentUserId: string;
}) {
  const pending = params.friendships.filter((row) => row.status === "pending");
  const incoming = pending.filter((row) => row.addressee_id === params.currentUserId);
  const outgoing = pending.filter((row) => row.requester_id === params.currentUserId);
  return { incoming, outgoing };
}

export function formatFriendshipDate(value: unknown) {
  return toIsoDate(value);
}
