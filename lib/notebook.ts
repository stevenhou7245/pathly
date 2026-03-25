import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getStudyRoomNotes,
  listStudyRoomAiMessages,
  listStudyRoomResources,
  type StudyRoomAiMessage,
  type StudyRoomNoteEntryRecord,
  type StudyRoomSharedResource,
} from "@/lib/studyRoomWorkspace";

type GenericRecord = Record<string, unknown>;

export type UserNotebookSourceType =
  | "manual"
  | "study_room_exit_save"
  | "study_room_manual_save";
export type UserNotebookItemSourceKind =
  | "study_room_note"
  | "study_room_resource"
  | "study_room_ai_exchange";

export type UserNotebookRecord = {
  id: string;
  user_id: string;
  topic: string;
  content_md: string | null;
  source_type: UserNotebookSourceType;
  source_room_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_deleted: boolean;
};

export type StudyRoomSavableNoteItem = {
  item_id: string;
  source_kind: "study_room_note";
  source_id: string;
  author_user_id: string;
  author_username: string | null;
  content_md: string;
  timestamp: string | null;
};

export type StudyRoomSavableResourceItem = {
  item_id: string;
  source_kind: "study_room_resource";
  source_id: string;
  title: string;
  resource_type: StudyRoomSharedResource["resource_type"];
  source_kind_value: StudyRoomSharedResource["source_kind"];
  url: string | null;
  file_name: string | null;
  added_by: string;
  added_by_username: string | null;
  timestamp: string | null;
};

export type StudyRoomSavableAiExchangeItem = {
  item_id: string;
  source_kind: "study_room_ai_exchange";
  question_message_id: string | null;
  answer_message_id: string | null;
  question_author_id: string | null;
  question_author_username: string | null;
  question_text: string | null;
  answer_text: string | null;
  timestamp: string | null;
};

export type StudyRoomSavableContent = {
  room_id: string;
  shared_notes: StudyRoomSavableNoteItem[];
  shared_resources: StudyRoomSavableResourceItem[];
  ai_exchanges: StudyRoomSavableAiExchangeItem[];
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown) {
  return value === true;
}

function normalizeSourceType(value: unknown): UserNotebookSourceType {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "manual" ||
    normalized === "study_room_exit_save" ||
    normalized === "study_room_manual_save"
  ) {
    return normalized;
  }
  return "manual";
}

function toErrorDetails(error: unknown) {
  const record = (error ?? {}) as GenericRecord;
  return {
    message: toStringValue(record.message) || "Unknown error",
    code: toNullableString(record.code),
    details: toNullableString(record.details),
    hint: toNullableString(record.hint),
  };
}

function compareIsoAsc(a: string | null, b: string | null) {
  return (a ?? "").localeCompare(b ?? "");
}

function isQuestionMessage(message: StudyRoomAiMessage) {
  return message.message_kind === "question" || message.sender_type === "user";
}

function isAnswerMessage(message: StudyRoomAiMessage) {
  return (
    message.message_kind === "answer" ||
    message.sender_type === "ai" ||
    message.role === "assistant"
  );
}

function groupAiMessagesToSavableExchanges(
  messages: StudyRoomAiMessage[],
): StudyRoomSavableAiExchangeItem[] {
  const consumed = new Set<number>();
  const exchanges: StudyRoomSavableAiExchangeItem[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    if (consumed.has(i)) {
      continue;
    }
    const current = messages[i];
    if (!current) {
      continue;
    }

    if (isQuestionMessage(current)) {
      let pairedAnswer: StudyRoomAiMessage | null = null;
      let pairedIndex = -1;
      for (let j = i + 1; j < messages.length; j += 1) {
        if (consumed.has(j)) {
          continue;
        }
        const candidate = messages[j];
        if (!candidate) {
          continue;
        }
        if (isAnswerMessage(candidate)) {
          pairedAnswer = candidate;
          pairedIndex = j;
          break;
        }
        if (isQuestionMessage(candidate)) {
          break;
        }
      }

      consumed.add(i);
      if (pairedIndex >= 0) {
        consumed.add(pairedIndex);
      }

      exchanges.push({
        item_id: `ai:${current.id}:${pairedAnswer?.id ?? "none"}`,
        source_kind: "study_room_ai_exchange",
        question_message_id: current.id,
        answer_message_id: pairedAnswer?.id ?? null,
        question_author_id: current.sender_id,
        question_author_username: current.sender_username,
        question_text: current.body || null,
        answer_text: pairedAnswer?.body ?? null,
        timestamp: pairedAnswer?.created_at ?? current.created_at ?? null,
      });
      continue;
    }

    consumed.add(i);
    exchanges.push({
      item_id: `ai:none:${current.id}`,
      source_kind: "study_room_ai_exchange",
      question_message_id: null,
      answer_message_id: current.id,
      question_author_id: null,
      question_author_username: null,
      question_text: null,
      answer_text: current.body || null,
      timestamp: current.created_at ?? null,
    });
  }

  return exchanges.sort((a, b) => compareIsoAsc(a.timestamp, b.timestamp));
}

function mapNotebookRow(row: GenericRecord): UserNotebookRecord {
  return {
    id: toStringValue(row.id),
    user_id: toStringValue(row.user_id),
    topic: toStringValue(row.topic),
    content_md: toNullableString(row.content_md),
    source_type: normalizeSourceType(row.source_type),
    source_room_id: toNullableString(row.source_room_id),
    created_at: toNullableString(row.created_at),
    updated_at: toNullableString(row.updated_at),
    is_deleted: toBoolean(row.is_deleted),
  };
}

function buildNotebookMarkdown(params: {
  topic: string;
  notes: StudyRoomSavableNoteItem[];
  resources: StudyRoomSavableResourceItem[];
  aiExchanges: StudyRoomSavableAiExchangeItem[];
}) {
  const lines: string[] = [];
  lines.push(`# Topic: ${params.topic}`);
  lines.push("");

  lines.push("## Shared Notes");
  if (params.notes.length === 0) {
    lines.push("- (none)");
  } else {
    params.notes.forEach((item) => {
      lines.push(`### ${item.author_username ?? "Unknown"}`);
      lines.push(item.content_md || "(empty)");
      if (item.timestamp) {
        lines.push(`_Saved from room at: ${item.timestamp}_`);
      }
      lines.push("");
    });
  }
  lines.push("");

  lines.push("## Shared Resources");
  if (params.resources.length === 0) {
    lines.push("- (none)");
  } else {
    params.resources.forEach((item) => {
      const resourceLink = item.url
        ? `- [${item.title}](${item.url})`
        : `- ${item.title}`;
      lines.push(resourceLink);
      lines.push(
        `  - Type: ${item.resource_type}, Source: ${item.source_kind_value}, Added by: ${item.added_by_username ?? "Unknown"}`,
      );
      if (item.timestamp) {
        lines.push(`  - Time: ${item.timestamp}`);
      }
    });
  }
  lines.push("");

  lines.push("## AI Tutor");
  if (params.aiExchanges.length === 0) {
    lines.push("- (none)");
  } else {
    params.aiExchanges.forEach((item) => {
      lines.push("### Question");
      lines.push(item.question_text || "(missing question)");
      lines.push("");
      lines.push("### Answer");
      lines.push(item.answer_text || "(missing answer)");
      if (item.timestamp) {
        lines.push(`_Time: ${item.timestamp}_`);
      }
      lines.push("");
    });
  }

  return lines.join("\n").trim();
}

function resolveMembershipFailureCode(params: {
  notesOk: boolean;
  notesCode?: string;
  resourcesOk: boolean;
  resourcesCode?: string;
  aiOk: boolean;
  aiCode?: string;
}) {
  const codes = [params.notesCode, params.resourcesCode, params.aiCode]
    .map((value) => value?.trim())
    .filter(Boolean);
  if (codes.includes("NOT_FOUND")) {
    return "NOT_FOUND" as const;
  }
  if (!params.notesOk || !params.resourcesOk || !params.aiOk) {
    return "FORBIDDEN" as const;
  }
  return null;
}

export async function listUserNotebooks(params: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("user_notebooks")
    .select("id, user_id, topic, content_md, source_type, source_room_id, created_at, updated_at, is_deleted")
    .eq("user_id", params.userId)
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false })
    .order("topic", { ascending: true });

  if (error) {
    const details = toErrorDetails(error);
    console.error("[user_notebook] list_failed", {
      table: "user_notebooks",
      user_id: params.userId,
      ...details,
    });
    throw new Error(`Failed to load user notebooks. table=user_notebooks reason=${details.message}`);
  }

  return ((data ?? []) as GenericRecord[]).map((row) => mapNotebookRow(row));
}

export async function createUserNotebook(params: {
  userId: string;
  topic: string;
  contentMd?: string | null;
  sourceType?: UserNotebookSourceType;
  sourceRoomId?: string | null;
}) {
  const normalizedTopic = params.topic.trim().slice(0, 200);
  if (!normalizedTopic) {
    throw new Error("Notebook topic is required.");
  }
  const payload = {
    user_id: params.userId,
    topic: normalizedTopic,
    content_md: params.contentMd?.trim() ? params.contentMd : null,
    source_type: params.sourceType ?? "manual",
    source_room_id: params.sourceRoomId ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("user_notebooks")
    .insert(payload)
    .select("id, user_id, topic, content_md, source_type, source_room_id, created_at, updated_at, is_deleted")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[user_notebook] create_failed", {
      table: "user_notebooks",
      user_id: params.userId,
      payload_keys: Object.keys(payload),
      ...details,
    });
    throw new Error(`Failed to create notebook. table=user_notebooks reason=${details.message}`);
  }

  return mapNotebookRow(data as GenericRecord);
}

export async function updateUserNotebook(params: {
  userId: string;
  notebookId: string;
  topic?: string;
  contentMd?: string | null;
}) {
  const updates: Record<string, unknown> = {};
  if (typeof params.topic === "string") {
    const trimmedTopic = params.topic.trim().slice(0, 200);
    if (!trimmedTopic) {
      throw new Error("Notebook topic is required.");
    }
    updates.topic = trimmedTopic;
  }
  if (params.contentMd !== undefined) {
    updates.content_md = params.contentMd?.trim() ? params.contentMd : null;
  }
  if (Object.keys(updates).length === 0) {
    throw new Error("No notebook changes provided.");
  }

  const { data, error } = await supabaseAdmin
    .from("user_notebooks")
    .update(updates)
    .eq("id", params.notebookId)
    .eq("user_id", params.userId)
    .eq("is_deleted", false)
    .select("id, user_id, topic, content_md, source_type, source_room_id, created_at, updated_at, is_deleted")
    .limit(1)
    .maybeSingle();

  if (error) {
    const details = toErrorDetails(error);
    console.error("[user_notebook] update_failed", {
      table: "user_notebooks",
      user_id: params.userId,
      notebook_id: params.notebookId,
      update_keys: Object.keys(updates),
      ...details,
    });
    throw new Error(`Failed to update notebook. table=user_notebooks reason=${details.message}`);
  }
  if (!data) {
    return null;
  }
  return mapNotebookRow(data as GenericRecord);
}

export async function loadStudyRoomSavableContent(params: {
  userId: string;
  roomId: string;
}) {
  const [notesResult, resourcesResult, aiResult] = await Promise.all([
    getStudyRoomNotes({
      userId: params.userId,
      roomId: params.roomId,
    }),
    listStudyRoomResources({
      userId: params.userId,
      roomId: params.roomId,
    }),
    listStudyRoomAiMessages({
      userId: params.userId,
      roomId: params.roomId,
    }),
  ]);

  if (!notesResult.ok || !resourcesResult.ok || !aiResult.ok) {
    const code = resolveMembershipFailureCode({
      notesOk: notesResult.ok,
      notesCode: notesResult.ok ? undefined : notesResult.code,
      resourcesOk: resourcesResult.ok,
      resourcesCode: resourcesResult.ok ? undefined : resourcesResult.code,
      aiOk: aiResult.ok,
      aiCode: aiResult.ok ? undefined : aiResult.code,
    });
    return {
      ok: false as const,
      code: code ?? "FORBIDDEN",
    };
  }

  const notesItems = (notesResult.entries ?? [])
    .filter((entry) => !entry.is_deleted && (entry.content_md?.trim() ?? ""))
    .map((entry) => {
      const content = entry.content_md?.trim() ?? "";
      return {
        item_id: `note:${entry.id}`,
        source_kind: "study_room_note",
        source_id: entry.id,
        author_user_id: entry.author_user_id,
        author_username: entry.author_username,
        content_md: content,
        timestamp: entry.updated_at ?? entry.created_at,
      } satisfies StudyRoomSavableNoteItem;
    })
    .sort((a, b) => compareIsoAsc(a.timestamp, b.timestamp));

  const resourceItems = (resourcesResult.resources ?? [])
    .map((resource) => {
      return {
        item_id: `resource:${resource.id}`,
        source_kind: "study_room_resource",
        source_id: resource.id,
        title: resource.title,
        resource_type: resource.resource_type,
        source_kind_value: resource.source_kind,
        url: resource.url,
        file_name: resource.file_name,
        added_by: resource.added_by,
        added_by_username: resource.added_by_username,
        timestamp: resource.created_at,
      } satisfies StudyRoomSavableResourceItem;
    })
    .sort((a, b) => compareIsoAsc(a.timestamp, b.timestamp));

  const aiExchanges = groupAiMessagesToSavableExchanges(aiResult.messages ?? []);

  return {
    ok: true as const,
    content: {
      room_id: params.roomId,
      shared_notes: notesItems,
      shared_resources: resourceItems,
      ai_exchanges: aiExchanges,
    } satisfies StudyRoomSavableContent,
  };
}

export async function saveStudyRoomContentToNotebook(params: {
  userId: string;
  roomId: string;
  topic: string;
  selectedItemIds: string[];
}) {
  const loaded = await loadStudyRoomSavableContent({
    userId: params.userId,
    roomId: params.roomId,
  });
  if (!loaded.ok) {
    return loaded;
  }

  const selectedIdSet = new Set(params.selectedItemIds.map((value) => value.trim()).filter(Boolean));

  const selectedNotes = loaded.content.shared_notes.filter((item) => selectedIdSet.has(item.item_id));
  const selectedResources = loaded.content.shared_resources.filter((item) => selectedIdSet.has(item.item_id));
  const selectedAiExchanges = loaded.content.ai_exchanges.filter((item) => selectedIdSet.has(item.item_id));

  const markdownContent = buildNotebookMarkdown({
    topic: params.topic,
    notes: selectedNotes,
    resources: selectedResources,
    aiExchanges: selectedAiExchanges,
  });

  const notebook = await createUserNotebook({
    userId: params.userId,
    topic: params.topic,
    contentMd: markdownContent,
    sourceType: "study_room_exit_save",
    sourceRoomId: params.roomId,
  });

  const itemRows: Array<Record<string, unknown>> = [];
  selectedNotes.forEach((item) => {
    itemRows.push({
      notebook_id: notebook.id,
      user_id: params.userId,
      source_kind: "study_room_note",
      source_id: item.source_id,
      source_room_id: params.roomId,
      title: `Note by ${item.author_username ?? "Unknown"}`,
      content_md: item.content_md,
      metadata: {
        author_user_id: item.author_user_id,
        author_username: item.author_username,
        timestamp: item.timestamp,
      },
      is_deleted: false,
    });
  });
  selectedResources.forEach((item) => {
    itemRows.push({
      notebook_id: notebook.id,
      user_id: params.userId,
      source_kind: "study_room_resource",
      source_id: item.source_id,
      source_room_id: params.roomId,
      title: item.title,
      content_md: item.url ? `[${item.title}](${item.url})` : item.title,
      metadata: {
        resource_type: item.resource_type,
        source_kind: item.source_kind_value,
        url: item.url,
        file_name: item.file_name,
        added_by: item.added_by,
        added_by_username: item.added_by_username,
        timestamp: item.timestamp,
      },
      is_deleted: false,
    });
  });
  selectedAiExchanges.forEach((item) => {
    itemRows.push({
      notebook_id: notebook.id,
      user_id: params.userId,
      source_kind: "study_room_ai_exchange",
      source_id: item.question_message_id ?? item.answer_message_id,
      source_room_id: params.roomId,
      title: "AI Tutor Exchange",
      content_md: [
        "Question:",
        item.question_text ?? "(missing question)",
        "",
        "Answer:",
        item.answer_text ?? "(missing answer)",
      ].join("\n"),
      metadata: {
        question_message_id: item.question_message_id,
        answer_message_id: item.answer_message_id,
        question_author_id: item.question_author_id,
        question_author_username: item.question_author_username,
        timestamp: item.timestamp,
      },
      is_deleted: false,
    });
  });

  if (itemRows.length > 0) {
    const insertResult = await supabaseAdmin.from("user_notebook_items").insert(itemRows);
    if (insertResult.error) {
      const details = toErrorDetails(insertResult.error);
      console.error("[user_notebook] save_selected_items_failed", {
        table: "user_notebook_items",
        notebook_id: notebook.id,
        user_id: params.userId,
        selected_items_count: itemRows.length,
        ...details,
      });

      await supabaseAdmin
        .from("user_notebooks")
        .update({
          is_deleted: true,
        })
        .eq("id", notebook.id)
        .eq("user_id", params.userId);

      throw new Error(
        `Failed to save notebook items. table=user_notebook_items reason=${details.message}`,
      );
    }
  }

  return {
    ok: true as const,
    notebook,
    selected_summary: {
      notes_count: selectedNotes.length,
      resources_count: selectedResources.length,
      ai_exchanges_count: selectedAiExchanges.length,
    },
  };
}
