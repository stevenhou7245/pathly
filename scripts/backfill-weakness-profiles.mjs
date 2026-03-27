import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 200;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] != null) {
      continue;
    }
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    process.env[key] = unquoted;
  }
}

function bootstrapEnv() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env.local"));
  loadEnvFile(path.join(cwd, ".env"));
}

function toStringValue(value) {
  return typeof value === "string" ? value : "";
}

function normalizeConceptTag(value) {
  const raw = toStringValue(value).toLowerCase();
  const cleaned = raw
    .replace(/[`~!@#$%^&*()+=\[\]{}\\|;:'",.<>/?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "";
  }
  const limited = cleaned.slice(0, 120);
  return limited.split(" ").filter(Boolean).slice(0, 8).join(" ").slice(0, 80);
}

function parseConceptTagArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeConceptTag(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => normalizeConceptTag(item)).filter(Boolean);
      }
    } catch {
      return trimmed
        .split(",")
        .map((item) => normalizeConceptTag(item))
        .filter(Boolean);
    }
  }
  return [];
}

function parseStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toStringValue(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => toStringValue(item).trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeAnswer(value) {
  return toStringValue(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function deriveFallbackConceptTag(params) {
  const fromQuestion = normalizeConceptTag(params.questionText);
  if (fromQuestion) {
    return fromQuestion;
  }
  const fromExplanation = normalizeConceptTag(params.explanation);
  if (fromExplanation) {
    return fromExplanation;
  }
  return "general foundation";
}

function deriveConceptTagsFromQuestion(questionRow) {
  const explicitTags = parseConceptTagArray(questionRow?.concept_tags);
  if (explicitTags.length > 0) {
    return [...new Set(explicitTags)];
  }
  return [
    deriveFallbackConceptTag({
      questionText: toStringValue(questionRow?.question_text),
      explanation: toStringValue(questionRow?.explanation),
    }),
  ];
}

function isAnswerCorrect(params) {
  const resultStatus = toStringValue(params.answerRow?.result_status).toLowerCase();
  if (resultStatus) {
    return resultStatus === "correct";
  }
  const normalizedUserAnswer = normalizeAnswer(params.answerRow?.user_answer_text);
  if (!normalizedUserAnswer) {
    return false;
  }

  const acceptableAnswers = new Set();
  const normalizedCorrectAnswer = normalizeAnswer(params.questionRow?.correct_answer_text);
  if (normalizedCorrectAnswer) {
    acceptableAnswers.add(normalizedCorrectAnswer);
  }
  const acceptableFromRow = parseStringArray(params.questionRow?.acceptable_answers).map((item) =>
    normalizeAnswer(item),
  );
  for (const answer of acceptableFromRow) {
    if (answer) {
      acceptableAnswers.add(answer);
    }
  }
  if (acceptableAnswers.size === 0) {
    return false;
  }
  return acceptableAnswers.has(normalizedUserAnswer);
}

function makeAggregateKey(params) {
  return `${params.userId}::${params.courseId}::${params.conceptTag}`;
}

async function selectAnswerRowsForTests(supabase, testIds) {
  const baseColumns = "user_test_id, question_id, user_answer_text, result_status, created_at";
  const fallbackColumns = "user_test_id, question_id, user_answer_text, created_at";
  const primary = await supabase
    .from("ai_user_test_answers")
    .select(baseColumns)
    .in("user_test_id", testIds);
  if (!primary.error) {
    return primary;
  }
  const message = toStringValue(primary.error.message).toLowerCase();
  if (!message.includes("result_status")) {
    return primary;
  }
  return supabase
    .from("ai_user_test_answers")
    .select(fallbackColumns)
    .in("user_test_id", testIds);
}

async function run() {
  bootstrapEnv();
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.info("[weakness_profiles] backfill:start", {
    batch_size: BATCH_SIZE,
  });

  const aggregateMap = new Map();
  let offset = 0;
  let scannedTests = 0;
  let scannedAnswers = 0;
  let scannedWrongAnswers = 0;

  while (true) {
    const { data: testRows, error: testError } = await supabase
      .from("ai_user_tests")
      .select("id, user_id, course_id, graded_at, submitted_at, created_at")
      .order("created_at", { ascending: true, nullsFirst: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (testError) {
      throw new Error(`[weakness_profiles] backfill failed loading ai_user_tests: ${testError.message}`);
    }

    const tests = testRows ?? [];
    if (tests.length === 0) {
      break;
    }
    scannedTests += tests.length;
    offset += tests.length;

    const testById = new Map();
    const testIds = [];
    for (const test of tests) {
      const id = toStringValue(test.id);
      const userId = toStringValue(test.user_id);
      const courseId = toStringValue(test.course_id);
      if (!id || !userId || !courseId) {
        continue;
      }
      const historicalTimestamp =
        toStringValue(test.graded_at) ||
        toStringValue(test.submitted_at) ||
        toStringValue(test.created_at) ||
        new Date().toISOString();
      testById.set(id, { userId, courseId, historicalTimestamp });
      testIds.push(id);
    }

    if (testIds.length === 0) {
      continue;
    }

    const { data: answerRows, error: answerError } = await selectAnswerRowsForTests(supabase, testIds);
    if (answerError) {
      throw new Error(`[weakness_profiles] backfill failed loading ai_user_test_answers: ${answerError.message}`);
    }
    const answers = answerRows ?? [];
    scannedAnswers += answers.length;

    const questionIds = [...new Set(
      answers.map((row) => toStringValue(row.question_id)).filter(Boolean),
    )];

    const questionById = new Map();
    if (questionIds.length > 0) {
      const { data: questionRows, error: questionError } = await supabase
        .from("ai_test_template_questions")
        .select("id, question_text, explanation, concept_tags, correct_answer_text, acceptable_answers")
        .in("id", questionIds);
      if (questionError) {
        throw new Error(
          `[weakness_profiles] backfill failed loading ai_test_template_questions: ${questionError.message}`,
        );
      }
      for (const question of questionRows ?? []) {
        const id = toStringValue(question.id);
        if (id) {
          questionById.set(id, question);
        }
      }
    }

    for (const answer of answers) {
      const testId = toStringValue(answer.user_test_id);
      const questionId = toStringValue(answer.question_id);
      if (!testId || !questionId) {
        continue;
      }
      const owner = testById.get(testId);
      if (!owner) {
        continue;
      }
      const question = questionById.get(questionId) ?? null;
      const isCorrect = isAnswerCorrect({
        answerRow: answer,
        questionRow: question,
      });
      if (isCorrect) {
        continue;
      }
      scannedWrongAnswers += 1;

      const conceptTags = deriveConceptTagsFromQuestion(question);
      const historicalTimestamp =
        toStringValue(answer.created_at) || owner.historicalTimestamp || new Date().toISOString();

      for (const conceptTag of conceptTags) {
        const key = makeAggregateKey({
          userId: owner.userId,
          courseId: owner.courseId,
          conceptTag,
        });
        const current =
          aggregateMap.get(key) ?? {
            userId: owner.userId,
            courseId: owner.courseId,
            conceptTag,
            count: 0,
            lastMistakeAt: historicalTimestamp,
          };
        current.count += 1;
        if (historicalTimestamp > current.lastMistakeAt) {
          current.lastMistakeAt = historicalTimestamp;
        }
        aggregateMap.set(key, current);
      }
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let failureCount = 0;
  let unchangedCount = 0;

  for (const item of aggregateMap.values()) {
    try {
      const { data: existing, error: existingError } = await supabase
        .from("weakness_profiles")
        .select("id, mistake_count, weakness_score, last_mistake_at")
        .eq("user_id", item.userId)
        .eq("course_id", item.courseId)
        .eq("concept_tag", item.conceptTag)
        .limit(1)
        .maybeSingle();
      if (existingError) {
        throw existingError;
      }

      if (!existing) {
        const { error: insertError } = await supabase
          .from("weakness_profiles")
          .insert({
            user_id: item.userId,
            course_id: item.courseId,
            concept_tag: item.conceptTag,
            mistake_count: item.count,
            weakness_score: item.count,
            last_mistake_at: item.lastMistakeAt,
            updated_at: new Date().toISOString(),
          });
        if (insertError) {
          throw insertError;
        }
        insertedCount += 1;
        continue;
      }

      const existingMistakeCount = Math.max(0, Math.floor(Number(existing.mistake_count) || 0));
      const existingWeaknessScore = Math.max(0, Math.floor(Number(existing.weakness_score) || 0));
      const nextMistakeCount = Math.max(existingMistakeCount, item.count);
      const nextWeaknessScore = Math.max(existingWeaknessScore, item.count);
      const existingLastMistakeAt = toStringValue(existing.last_mistake_at);
      const nextLastMistakeAt =
        existingLastMistakeAt && existingLastMistakeAt > item.lastMistakeAt
          ? existingLastMistakeAt
          : item.lastMistakeAt;

      if (
        nextMistakeCount === existingMistakeCount &&
        nextWeaknessScore === existingWeaknessScore &&
        nextLastMistakeAt === existingLastMistakeAt
      ) {
        unchangedCount += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("weakness_profiles")
        .update({
          mistake_count: nextMistakeCount,
          weakness_score: nextWeaknessScore,
          last_mistake_at: nextLastMistakeAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", toStringValue(existing.id));
      if (updateError) {
        throw updateError;
      }
      updatedCount += 1;
    } catch (error) {
      failureCount += 1;
      console.error("[weakness_profiles] backfill:failed", {
        user_id: item.userId,
        course_id: item.courseId,
        concept_tag: item.conceptTag,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.info("[weakness_profiles] backfill:scanned", {
    scanned_tests: scannedTests,
    scanned_answers: scannedAnswers,
    scanned_wrong_answers: scannedWrongAnswers,
    aggregated_concepts: aggregateMap.size,
  });
  console.info("[weakness_profiles] backfill:inserted", {
    inserted_rows: insertedCount,
  });
  console.info("[weakness_profiles] backfill:updated", {
    updated_rows: updatedCount,
    unchanged_rows: unchangedCount,
    failed_rows: failureCount,
  });
}

run().catch((error) => {
  console.error("[weakness_profiles] backfill:failed", {
    reason: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
