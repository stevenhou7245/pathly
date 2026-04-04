"use client";

import type { LearningFolder } from "@/components/dashboardData";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatCourseDifficultyLabel,
  type CourseDifficultyLevel,
} from "@/lib/courseDifficulty";
import { playSound } from "@/lib/sound";

type LearningFieldPanelProps = {
  folder: LearningFolder;
  onPathProgressChange?: (update: {
    fieldEntryId: string;
    totalSteps: number;
    currentStepIndex: number;
    completedSteps: number;
    progress: number;
    origin?: "initial_load" | "mutation";
  }) => void;
};

type CourseNodeStatus = "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
type RightPanelState =
  | "idle"
  | "loading_summary"
  | "generating_journey"
  | "loading_journey"
  | "ready"
  | "error";

type JourneyNode = {
  step_number: number;
  course_id: string;
  title: string;
  status: CourseNodeStatus;
  passed_score: number | null;
};

type JourneyData = {
  journey_path_id: string;
  total_steps: number;
  current_step: number;
  learning_field_id: string;
  nodes: JourneyNode[];
};

const journeyRequestInFlight = new Map<string, Promise<JourneyApiResponse>>();

type JourneyApiResponse = {
  success: boolean;
  message?: string;
  journey?: JourneyData;
};

type CourseResource = {
  id: string;
  title: string;
  resource_type: string;
  provider: string;
  url: string;
  summary: string | null;
  average_rating: number;
  comment_count: number;
  my_rating: number | null;
  comment_previews: Array<{
    id: string;
    comment_text: string;
    created_at: string;
    username: string | null;
  }>;
};

type CourseDetails = {
  id: string;
  journey_path_id: string;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
  difficulty_level: CourseDifficultyLevel | null;
  skill_tags: string[];
  status: CourseNodeStatus;
  last_test_score: number | null;
  best_test_score: number | null;
  attempt_count: number;
  passed_at: string | null;
  last_activity_at: string | null;
  ready_for_test_at: string | null;
  current_test_attempt_id: string | null;
  required_test_score: number;
  can_take_test: boolean;
  weakness_concepts: string[] | null;
  resources: CourseResource[];
};

type CourseApiResponse = {
  success: boolean;
  message?: string;
  course?: CourseDetails;
};

type CourseStartApiResponse = {
  success: boolean;
  message?: string;
  resource_url?: string;
};

type CourseTestQuestion = {
  id: string;
  question_order: number;
  question_text: string;
  question_type: "multiple_choice" | "fill_blank" | "short_answer";
  options: string[];
  score: number;
};

type CourseTestPrepareApiResponse = {
  success: boolean;
  message?: string;
  test?: {
    course_id: string;
    journey_path_id: string;
    user_test_id: string;
    test_attempt_id: string;
    status: CourseNodeStatus;
    required_score: number;
    questions: CourseTestQuestion[];
  };
};

type CourseTestSubmitApiResponse = {
  success: boolean;
  message?: string;
  result?: {
    user_test_id: string;
    attempt_number: number;
    total_score: number;
    earned_score: number;
    score: number;
    pass_status: "passed" | "failed";
    passed: boolean;
    required_score: number;
    course_completed: boolean;
    attempt_count: number;
    last_test_score: number;
    best_test_score: number | null;
    completion_awarded: boolean;
    feedback_summary: string;
    graded_at: string;
    question_results: Array<{
      question_id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      user_answer: string;
      correct_answer: string;
      is_correct: boolean;
      earned_score: number;
      max_score: number;
      result_status: "correct" | "partial" | "incorrect";
      explanation: string;
    }>;
    journey: JourneyData;
  };
};

type CourseTestAttemptHistoryApiResponse = {
  success: boolean;
  message?: string;
  attempts?: Array<{
    user_test_id: string;
    attempt_number: number;
    earned_score: number;
    total_score: number;
    pass_status: "passed" | "failed";
    graded_at: string | null;
    submitted_at: string | null;
  }>;
  best_score?: number | null;
  has_any_attempt?: boolean;
};

type CourseTestAttemptDetailApiResponse = {
  success: boolean;
  message?: string;
  attempt?: {
    user_test_id: string;
    course_id: string;
    course_title: string | null;
    course_description: string | null;
    status: string;
    attempt_number: number;
    total_score: number;
    earned_score: number;
    pass_status: "passed" | "failed";
    required_score: number;
    feedback_summary: string;
    graded_at: string | null;
    submitted_at: string | null;
    question_results: Array<{
      question_id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      options: string[];
      user_answer: string;
      correct_answer: string;
      is_correct: boolean;
      earned_score: number;
      max_score: number;
      result_status: "correct" | "partial" | "incorrect";
      explanation: string;
      feedback: string;
    }>;
  };
};

type AiTestReviewResult = {
  user_test_id: string;
  attempt_number: number;
  total_score: number;
  earned_score: number;
  score: number;
  pass_status: "passed" | "failed";
  passed: boolean;
  required_score: number;
  course_completed: boolean;
  attempt_count: number;
  last_test_score: number;
  best_test_score: number | null;
  completion_awarded: boolean;
  feedback_summary: string;
  graded_at: string | null;
  question_results: Array<{
    question_id: string;
    question_order: number;
    question_type: "multiple_choice" | "fill_blank" | "short_answer";
    question_text: string;
    options?: string[];
    user_answer: string;
    correct_answer: string;
    is_correct: boolean;
    earned_score: number;
    max_score: number;
    result_status: "correct" | "partial" | "incorrect";
    explanation: string;
    feedback?: string;
  }>;
  journey?: JourneyData;
};

type AiTestMode = "taking" | "graded" | "history";
type JourneyInitStatus = "not_started" | "initializing" | "ready" | "failed";

type RatingApiResponse = {
  success: boolean;
  message?: string;
};

type CommentApiResponse = {
  success: boolean;
  message?: string;
};

function formatResourceType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "Tutorial";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function getScoreBandFeedback(score: number) {
  if (score >= 100) {
    return "Excellent!";
  }
  if (score >= 90) {
    return "Great Work!";
  }
  if (score >= 80) {
    return "Good Job!";
  }
  if (score >= 60) {
    return "Passed!";
  }
  return "Continue Learning~";
}

function getScoreBandMessage(score: number) {
  return `Mark: ${score}  ${getScoreBandFeedback(score)}`;
}

function getScoreBandEmoji(score: number) {
  if (score >= 100) {
    return "🏆";
  }
  if (score >= 90) {
    return "🎉";
  }
  if (score >= 80) {
    return "⭐";
  }
  if (score >= 60) {
    return "🙂";
  }
  return "💪";
}

function getResultStatusIcon(status: "correct" | "partial" | "incorrect") {
  if (status === "correct") {
    return "✓";
  }
  if (status === "partial") {
    return "◐";
  }
  return "✕";
}

function getNodeClassName(status: CourseNodeStatus, options?: { pop?: boolean }) {
  const base =
    "relative flex h-16 w-16 items-center justify-center rounded-full border-2 text-sm font-extrabold motion-journey-node";
  const popClass = options?.pop ? " motion-node-pop" : "";

  if (status === "passed") {
    return `${base} is-clickable border-[#1F2937] bg-[#FFD84D] text-[#1F2937] shadow-[0_4px_0_rgba(31,41,55,0.18)]${popClass}`;
  }

  if (status === "ready_for_test") {
    return `${base} is-clickable border-[#1F2937] bg-[#D9F99D] text-[#1F2937] shadow-[0_4px_0_rgba(31,41,55,0.16)] ring-2 ring-[#58CC02]/20${popClass}`;
  }

  if (status === "in_progress") {
    return `${base} is-clickable border-[#1F2937] bg-[#58CC02] text-white shadow-[0_5px_0_#1f2937] ring-2 ring-[#58CC02]/25${popClass}`;
  }

  if (status === "unlocked") {
    return `${base} is-clickable border-[#1F2937] bg-white text-[#1F2937] shadow-[0_4px_0_rgba(31,41,55,0.18)] hover:-translate-y-0.5${popClass}`;
  }

  return `${base} cursor-not-allowed border-[#9CA3AF] bg-[#D1D5DB] text-[#6B7280] opacity-60${popClass}`;
}

function getConnectorClassName(_current: CourseNodeStatus, next: CourseNodeStatus) {
  const active =
    next === "passed" ||
    next === "in_progress" ||
    next === "ready_for_test" ||
    next === "unlocked";

  return active
    ? "h-2.5 w-2.5 rounded-full bg-[#58CC02] transition-colors duration-200"
    : "h-2.5 w-2.5 rounded-full bg-[#D1D5DB] transition-colors duration-200";
}

function getPrimaryLearnActionLabel(status: CourseNodeStatus) {
  if (status === "unlocked") {
    return "Start learning";
  }
  if (status === "in_progress") {
    return "Continue learning";
  }
  if (status === "ready_for_test") {
    return "Take AI Test";
  }
  if (status === "passed") {
    return "Review course";
  }
  return "Start learning";
}

export default function LearningFieldPanel({
  folder,
  onPathProgressChange,
}: LearningFieldPanelProps) {
  const router = useRouter();
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [panelState, setPanelState] = useState<RightPanelState>("idle");
  const [isLoadingJourney, setIsLoadingJourney] = useState(true);
  const [journeyError, setJourneyError] = useState("");

  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [courseDetails, setCourseDetails] = useState<CourseDetails | null>(null);
  const [isLoadingCourse, setIsLoadingCourse] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [isAiTestModalOpen, setIsAiTestModalOpen] = useState(false);
  const [aiTestError, setAiTestError] = useState("");
  const [activeAiTest, setActiveAiTest] = useState<{
    courseId: string;
    courseTitle: string;
  } | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [isStartingCourse, setIsStartingCourse] = useState(false);
  const [isPreparingTest, setIsPreparingTest] = useState(false);
  const [isSubmittingTest, setIsSubmittingTest] = useState(false);
  const [isCheckingPreviousTests, setIsCheckingPreviousTests] = useState(false);
  const [isLoadingAttemptHistory, setIsLoadingAttemptHistory] = useState(false);
  const [isLoadingAttemptDetail, setIsLoadingAttemptDetail] = useState(false);
  const [testQuestions, setTestQuestions] = useState<CourseTestQuestion[]>([]);
  const [activeUserTestId, setActiveUserTestId] = useState("");
  const [testResponses, setTestResponses] = useState<
    Record<string, { selectedOptionIndex: number | null; answerText: string }>
  >({});
  const [requiredTestScore, setRequiredTestScore] = useState(60);
  const [testFeedback, setTestFeedback] = useState("");
  const [testResult, setTestResult] = useState<AiTestReviewResult | null>(null);
  const [aiTestMode, setAiTestMode] = useState<AiTestMode>("taking");
  const [attemptHistory, setAttemptHistory] = useState<
    NonNullable<CourseTestAttemptHistoryApiResponse["attempts"]>
  >([]);
  const [showResultPopup, setShowResultPopup] = useState(false);
  const [resultPopupPayload, setResultPopupPayload] = useState<{
    score: number;
    passed: boolean;
    feedback: string;
    emoji: string;
    message: string;
  } | null>(null);
  const [hasAnyPreviousTestAttempts, setHasAnyPreviousTestAttempts] = useState(false);
  const [ratingDraft, setRatingDraft] = useState<Record<string, number>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [isSubmittingResourceAction, setIsSubmittingResourceAction] = useState(false);
  const [poppingNodeIds, setPoppingNodeIds] = useState<string[]>([]);
  const journeyRequestIdRef = useRef(0);
  const courseRequestIdRef = useRef(0);
  const journeyRef = useRef<JourneyData | null>(null);
  const nodePopTimeoutRef = useRef<number | null>(null);
  const initStatusByFieldRef = useRef<Map<string, JourneyInitStatus>>(new Map());
  const inFlightGenerateFieldRef = useRef<Map<string, Promise<JourneyData>>>(new Map());

  const completedCount = useMemo(() => {
    return journey?.nodes.filter((node) => node.status === "passed").length ?? 0;
  }, [journey?.nodes]);

  const progressPercentage = useMemo(() => {
    if (!journey || journey.total_steps <= 0) {
      return 0;
    }
    return Math.floor((completedCount / journey.total_steps) * 100);
  }, [completedCount, journey]);

  const transitionPanelState = useCallback(
    (next: RightPanelState, reason: string, detail?: Record<string, unknown>) => {
      setPanelState((previous) => {
        if (previous === next) {
          return previous;
        }
        console.info("[learning_panel] state_transition", {
          from: previous,
          to: next,
          reason,
          field_id: folder.fieldId ?? "",
          field_entry_id: folder.id,
          ...(detail ?? {}),
        });
        return next;
      });
    },
    [folder.fieldId, folder.id],
  );

  const emitProgress = useCallback(
    (nextJourney: JourneyData, origin: "initial_load" | "mutation") => {
      const completedSteps = nextJourney.nodes.filter((node) => node.status === "passed").length;
      const currentNode =
        nextJourney.nodes.find(
          (node) =>
            node.status === "in_progress" ||
            node.status === "unlocked" ||
            node.status === "ready_for_test",
        ) ?? null;
      const currentStepIndex = currentNode ? currentNode.step_number : nextJourney.total_steps;
      const percentage =
        nextJourney.total_steps <= 0
          ? 0
          : Math.floor((completedSteps / nextJourney.total_steps) * 100);

      onPathProgressChange?.({
        fieldEntryId: folder.id,
        totalSteps: nextJourney.total_steps,
        currentStepIndex,
        completedSteps,
        progress: percentage,
        origin,
      });
    },
    [folder.id, onPathProgressChange],
  );

  useEffect(() => {
    journeyRef.current = journey;
  }, [journey]);

  const triggerNodePop = useCallback((courseIds: string[]) => {
    const uniqueIds = Array.from(new Set(courseIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      return;
    }
    setPoppingNodeIds(uniqueIds);
    if (nodePopTimeoutRef.current !== null) {
      window.clearTimeout(nodePopTimeoutRef.current);
    }
    nodePopTimeoutRef.current = window.setTimeout(() => {
      setPoppingNodeIds([]);
      nodePopTimeoutRef.current = null;
    }, 260);
  }, []);

  useEffect(
    () => () => {
      if (nodePopTimeoutRef.current !== null) {
        window.clearTimeout(nodePopTimeoutRef.current);
      }
    },
    [],
  );

  const loadJourney = useCallback(
    async (options?: { reason?: string; force?: boolean }) => {
      const reason = options?.reason ?? "auto_init";
      const force = Boolean(options?.force);
      const requestId = journeyRequestIdRef.current + 1;
      journeyRequestIdRef.current = requestId;

      setIsLoadingJourney(true);
      setJourneyError("");

      const fieldId = folder.fieldId?.trim() ?? "";
      const summaryJourneyPathId = folder.journeyPathId?.trim() ?? "";
      transitionPanelState("loading_summary", reason, {
        selected_field_id: fieldId,
        summary_journey_path_id: summaryJourneyPathId || null,
        init_status: initStatusByFieldRef.current.get(fieldId) ?? "not_started",
      });

      if (!fieldId) {
        if (journeyRequestIdRef.current === requestId) {
          const message = "Learning field metadata is missing.";
          setJourneyError(message);
          setIsLoadingJourney(false);
          setJourney(null);
          transitionPanelState("error", reason, {
            selected_field_id: fieldId,
            message,
          });
        }
        return;
      }

      const fetchJourneyById = async (journeyPathId: string) => {
        transitionPanelState("loading_journey", reason, {
          selected_field_id: fieldId,
          journey_path_id: journeyPathId,
          source: "summary",
        });

        const dedupeKey = `journey:${journeyPathId}`;
        const inFlight = journeyRequestInFlight.get(dedupeKey);
        const payloadPromise =
          inFlight ??
          (async () => {
            const response = await fetch(`/api/journey/${encodeURIComponent(journeyPathId)}`, {
              method: "GET",
              cache: "no-store",
            });
            const payload = (await response.json()) as JourneyApiResponse;
            if (!response.ok) {
              throw new Error(payload.message ?? "Unable to load journey right now.");
            }
            return payload;
          })();

        if (!inFlight) {
          journeyRequestInFlight.set(dedupeKey, payloadPromise);
        }

        let payload: JourneyApiResponse;
        try {
          payload = await payloadPromise;
        } finally {
          journeyRequestInFlight.delete(dedupeKey);
        }

        if (!payload.success || !payload.journey) {
          throw new Error(payload.message ?? "Unable to load journey right now.");
        }
        return payload.journey;
      };

      try {
        let resolvedJourney: JourneyData | null = null;

        if (summaryJourneyPathId) {
          try {
            resolvedJourney = await fetchJourneyById(summaryJourneyPathId);
            console.info("[learning_panel] generation_skip_existing_journey", {
              selected_field_id: fieldId,
              journey_path_id: summaryJourneyPathId,
              reason,
            });
          } catch (error) {
            console.warn("[learning_panel] load_existing_journey_failed", {
              selected_field_id: fieldId,
              journey_path_id: summaryJourneyPathId,
              reason,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (!resolvedJourney) {
          const existingInFlightGeneration = inFlightGenerateFieldRef.current.get(fieldId);
          if (existingInFlightGeneration) {
            initStatusByFieldRef.current.set(fieldId, "initializing");
            console.info("[learning_panel] initialization_already_in_progress", {
              selected_field_id: fieldId,
              reason,
              force,
              retry_allowed: true,
            });
            resolvedJourney = await existingInFlightGeneration;
          } else {
            initStatusByFieldRef.current.set(fieldId, "initializing");
            const generatePromise = (async () => {
              transitionPanelState("generating_journey", reason, {
                selected_field_id: fieldId,
                trigger: summaryJourneyPathId
                  ? "existing_journey_load_failed"
                  : "missing_journey_path",
                force,
              });
              console.info("[learning_panel] initialization_started", {
                selected_field_id: fieldId,
                reason,
                summary_journey_path_id: summaryJourneyPathId || null,
                force,
                retry_allowed: true,
              });

              const response = await fetch("/api/journey/generate", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  learning_field_id: fieldId,
                  starting_point: folder.currentLevel,
                  destination: folder.targetLevel,
                }),
              });

              const payload = (await response.json()) as JourneyApiResponse;
              if (!response.ok || !payload.success || !payload.journey) {
                throw new Error(payload.message ?? "Unable to load journey right now.");
              }

              return payload.journey;
            })();

            inFlightGenerateFieldRef.current.set(fieldId, generatePromise);
            try {
              resolvedJourney = await generatePromise;
              initStatusByFieldRef.current.set(fieldId, "ready");
              console.info("[learning_panel] initialization_completed", {
                selected_field_id: fieldId,
                reason,
              });
            } catch (error) {
              initStatusByFieldRef.current.set(fieldId, "failed");
              console.warn("[learning_panel] initialization_failed", {
                selected_field_id: fieldId,
                reason,
                message: error instanceof Error ? error.message : String(error),
                retry_allowed: true,
              });
              throw error;
            } finally {
              inFlightGenerateFieldRef.current.delete(fieldId);
            }
          }
        }

        if (journeyRequestIdRef.current !== requestId) {
          return;
        }

        if (!resolvedJourney) {
          throw new Error("Journey response is empty.");
        }

        setJourney(resolvedJourney);
        emitProgress(resolvedJourney, "initial_load");
        setJourneyError("");
        initStatusByFieldRef.current.set(fieldId, "ready");
        transitionPanelState("ready", reason, {
          selected_field_id: fieldId,
          journey_path_id: resolvedJourney.journey_path_id,
          total_steps: resolvedJourney.total_steps,
        });
      } catch (error) {
        if (journeyRequestIdRef.current !== requestId) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to load journey right now.";
        setJourneyError(message);
        setJourney(null);
        initStatusByFieldRef.current.set(fieldId, "failed");
        transitionPanelState("error", reason, {
          selected_field_id: fieldId,
          message,
        });
      } finally {
        if (journeyRequestIdRef.current === requestId) {
          setIsLoadingJourney(false);
        }
      }
    },
    [
      emitProgress,
      folder.currentLevel,
      folder.fieldId,
      folder.journeyPathId,
      folder.targetLevel,
      transitionPanelState,
    ],
  );

  useEffect(() => {
    const fieldId = folder.fieldId?.trim() ?? "";
    const summaryJourneyPathId = folder.journeyPathId?.trim() ?? "";
    const initStatus = initStatusByFieldRef.current.get(fieldId) ?? "not_started";
    const currentJourney = journeyRef.current;
    const isSameLoadedJourney =
      Boolean(currentJourney) &&
      currentJourney?.learning_field_id === fieldId &&
      (!summaryJourneyPathId || currentJourney?.journey_path_id === summaryJourneyPathId);

    if (fieldId && initStatus === "ready" && isSameLoadedJourney) {
      console.info("[learning_panel] init_skip_existing", {
        selected_field_id: fieldId,
        summary_journey_path_id: summaryJourneyPathId || null,
        init_status: initStatus,
      });
      transitionPanelState("ready", "skip_existing");
      return;
    }

    void loadJourney({
      reason: "field_change",
    });
  }, [
    folder.fieldId,
    folder.journeyPathId,
    loadJourney,
    transitionPanelState,
  ]);

  useEffect(() => {
    setSelectedCourseId("");
    setCourseDetails(null);
    setCourseError("");
    setIsAiTestModalOpen(false);
    setAiTestError("");
    setActiveAiTest(null);
    setActionMessage("");
    setSelectedResourceId("");
    setTestQuestions([]);
    setActiveUserTestId("");
    setTestResponses({});
    setRequiredTestScore(60);
    setTestFeedback("");
    setTestResult(null);
    setAiTestMode("taking");
    setAttemptHistory([]);
    setShowResultPopup(false);
    setResultPopupPayload(null);
    setHasAnyPreviousTestAttempts(false);
    setRatingDraft({});
    setCommentDraft({});
  }, [folder.id]);

  const isCourseModalOpen = selectedCourseId.length > 0;

  const loadCourseDetails = useCallback(
    async (
      courseId: string,
      options?: {
        preserveAiTestState?: boolean;
        keepSelectedResource?: boolean;
      },
    ) => {
      if (!journey) {
        return;
      }
      const requestId = courseRequestIdRef.current + 1;
      courseRequestIdRef.current = requestId;

      setIsLoadingCourse(true);
      setCourseError("");
      setActionMessage("");
      setSelectedCourseId(courseId);

      try {
        const response = await fetch(
          `/api/course/${courseId}/details?journey_path_id=${encodeURIComponent(journey.journey_path_id)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response.json()) as CourseApiResponse;
        if (!response.ok || !payload.success || !payload.course) {
          throw new Error(payload.message ?? "Unable to load course details right now.");
        }

        if (courseRequestIdRef.current !== requestId) {
          return;
        }

        setCourseDetails(payload.course);
        setIsCheckingPreviousTests(true);
        try {
          const attemptsResponse = await fetch(
            `/api/course/test/attempts?course_id=${encodeURIComponent(payload.course.id)}`,
            {
              method: "GET",
              cache: "no-store",
            },
          );
          const attemptsPayload =
            (await attemptsResponse.json()) as CourseTestAttemptHistoryApiResponse;
          if (courseRequestIdRef.current === requestId) {
            setHasAnyPreviousTestAttempts(
              Boolean(
                attemptsPayload.has_any_attempt ??
                  ((attemptsPayload.attempts ?? []).length > 0),
              ),
            );
          }
        } catch {
          if (courseRequestIdRef.current === requestId) {
            setHasAnyPreviousTestAttempts(false);
          }
        } finally {
          if (courseRequestIdRef.current === requestId) {
            setIsCheckingPreviousTests(false);
          }
        }

        if (!options?.keepSelectedResource) {
          setSelectedResourceId(payload.course.resources[0]?.id ?? "");
        }
        if (!options?.preserveAiTestState) {
          setIsAiTestModalOpen(false);
          setAiTestError("");
          setActiveAiTest(null);
          setTestQuestions([]);
          setActiveUserTestId("");
          setTestResponses({});
          setRequiredTestScore(60);
          setTestFeedback("");
          setTestResult(null);
          setAiTestMode("taking");
          setAttemptHistory([]);
          setShowResultPopup(false);
          setResultPopupPayload(null);
        }
      } catch (error) {
        if (courseRequestIdRef.current !== requestId) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Unable to load course details right now.";
        setCourseError(message);
        setCourseDetails(null);
        setHasAnyPreviousTestAttempts(false);
        setIsCheckingPreviousTests(false);
      } finally {
        if (courseRequestIdRef.current === requestId) {
          setIsLoadingCourse(false);
        }
      }
    },
    [journey],
  );

  function closeModal() {
    if (isStartingCourse || isPreparingTest || isSubmittingTest || isSubmittingResourceAction) {
      return;
    }
    setIsAiTestModalOpen(false);
    setAiTestError("");
    setActiveAiTest(null);
    setSelectedCourseId("");
    setCourseDetails(null);
    setCourseError("");
    setActionMessage("");
    setSelectedResourceId("");
    setTestQuestions([]);
    setActiveUserTestId("");
    setTestResponses({});
    setRequiredTestScore(60);
    setTestFeedback("");
    setTestResult(null);
    setAiTestMode("taking");
    setAttemptHistory([]);
    setShowResultPopup(false);
    setResultPopupPayload(null);
    setHasAnyPreviousTestAttempts(false);
  }

  function closeAiTestModal() {
    if (isPreparingTest || isSubmittingTest) {
      return;
    }
    setAiTestError("");
    setShowResultPopup(false);
    setResultPopupPayload(null);
    setIsAiTestModalOpen(false);
  }

  function dismissResultPopup() {
    setShowResultPopup(false);
    setResultPopupPayload(null);
  }

  async function handleNodeClick(node: JourneyNode) {
    setJourneyError("");

    if (node.status === "locked") {
      setJourneyError("Please complete previous courses");
      playSound("error");
      return;
    }

    playSound("click");
    await loadCourseDetails(node.course_id);
  }

  async function handleStartCourse() {
    if (!courseDetails || !journey || !selectedResourceId) {
      playSound("error");
      return;
    }

    setIsStartingCourse(true);
    setCourseError("");
    setActionMessage("");

    try {
      const response = await fetch("/api/course/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          course_id: courseDetails.id,
          journey_path_id: journey.journey_path_id,
          selected_resource_id: selectedResourceId,
        }),
      });

      const payload = (await response.json()) as CourseStartApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to start course right now.");
      }

      setActionMessage("Learning resource opened in a new tab.");
      setTestFeedback("");
      playSound("click");

      setJourney((previous) => {
        if (!previous) {
          return previous;
        }

        const nextJourney: JourneyData = {
          ...previous,
          nodes: previous.nodes.map((node) => {
            if (node.course_id !== courseDetails.id || node.status === "passed") {
              return node;
            }
            return {
              ...node,
              status: "in_progress",
            };
          }),
        };
        emitProgress(nextJourney, "mutation");
        return nextJourney;
      });

      if (payload.resource_url) {
        window.open(payload.resource_url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start course right now.";
      setCourseError(message);
      playSound("error");
    } finally {
      setIsStartingCourse(false);
    }
  }

  async function handlePrepareTest(options?: { forceNewAttempt?: boolean }) {
    if (!courseDetails || !journey) {
      return;
    }

    const forceNewAttempt = Boolean(options?.forceNewAttempt);
    if (
      !forceNewAttempt &&
      activeAiTest?.courseId === courseDetails.id &&
      (testQuestions.length > 0 || testResult !== null)
    ) {
      setIsAiTestModalOpen(true);
      return;
    }

    setIsPreparingTest(true);
    setAiTestError("");
    setActionMessage("");
    setTestFeedback("");
    setActiveUserTestId("");
    setTestResult(null);
    setAiTestMode("taking");
    setAttemptHistory([]);
    setShowResultPopup(false);
    setResultPopupPayload(null);

    try {
      const response = await fetch("/api/course/test/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          course_id: courseDetails.id,
          journey_path_id: journey.journey_path_id,
          selected_resource_id: selectedResourceId || undefined,
        }),
      });

      const payload = (await response.json()) as CourseTestPrepareApiResponse;
      if (!response.ok || !payload.success || !payload.test) {
        throw new Error(payload.message ?? "Unable to prepare AI test right now.");
      }

      setTestQuestions(payload.test.questions);
      setActiveUserTestId(payload.test.user_test_id || payload.test.test_attempt_id);
      setTestResponses({});
      setRequiredTestScore(payload.test.required_score);
      setActiveAiTest({
        courseId: courseDetails.id,
        courseTitle: courseDetails.title,
      });
      setHasAnyPreviousTestAttempts(true);
      setAiTestMode("taking");
      setIsAiTestModalOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to prepare AI test right now.";
      setAiTestError(message);
      setIsAiTestModalOpen(false);
    } finally {
      setIsPreparingTest(false);
    }
  }

  function updateTestChoiceAnswer(questionId: string, selectedOptionIndex: number) {
    setTestResponses((previous) => ({
      ...previous,
      [questionId]: {
        selectedOptionIndex,
        answerText: previous[questionId]?.answerText ?? "",
      },
    }));
  }

  function updateTestTextAnswer(questionId: string, answerText: string) {
    setTestResponses((previous) => ({
      ...previous,
      [questionId]: {
        selectedOptionIndex: previous[questionId]?.selectedOptionIndex ?? null,
        answerText,
      },
    }));
  }

  function toReviewResultFromAttemptDetail(
    detail: NonNullable<CourseTestAttemptDetailApiResponse["attempt"]>,
  ): AiTestReviewResult {
    return {
      user_test_id: detail.user_test_id,
      attempt_number: detail.attempt_number,
      total_score: detail.total_score,
      earned_score: detail.earned_score,
      score: detail.earned_score,
      pass_status: detail.pass_status,
      passed: detail.pass_status === "passed",
      required_score: detail.required_score,
      course_completed: detail.pass_status === "passed",
      attempt_count: detail.attempt_number,
      last_test_score: detail.earned_score,
      best_test_score: null,
      completion_awarded: false,
      feedback_summary: detail.feedback_summary,
      graded_at: detail.graded_at,
      question_results: detail.question_results,
    };
  }

  async function handleLoadAttemptHistory(options?: { openFirstAttempt?: boolean }) {
    if (!courseDetails) {
      return;
    }

    setIsLoadingAttemptHistory(true);
    setAiTestError("");
    try {
      const response = await fetch(
        `/api/course/test/attempts?course_id=${encodeURIComponent(courseDetails.id)}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as CourseTestAttemptHistoryApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load test attempts right now.");
      }

      const attempts = payload.attempts ?? [];
      setAttemptHistory(attempts);
      setHasAnyPreviousTestAttempts(
        Boolean(payload.has_any_attempt ?? attempts.length > 0),
      );
      setAiTestMode("history");
      if (
        options?.openFirstAttempt &&
        attempts.length > 0 &&
        (!testResult || testResult.user_test_id !== attempts[0]?.user_test_id)
      ) {
        await handleLoadAttemptDetail(attempts[0].user_test_id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load test attempts right now.";
      setAiTestError(message);
    } finally {
      setIsLoadingAttemptHistory(false);
    }
  }

  async function handleLoadAttemptDetail(userTestId: string) {
    if (!userTestId) {
      return;
    }

    setIsLoadingAttemptDetail(true);
    setAiTestError("");
    try {
      const response = await fetch(
        `/api/course/test/attempts/${encodeURIComponent(userTestId)}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as CourseTestAttemptDetailApiResponse;
      if (!response.ok || !payload.success || !payload.attempt) {
        throw new Error(payload.message ?? "Unable to load test attempt detail right now.");
      }

      setActiveUserTestId(payload.attempt.user_test_id);
      setTestResult(toReviewResultFromAttemptDetail(payload.attempt));
      setAiTestMode("history");
      setShowResultPopup(false);
      setResultPopupPayload(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load test attempt detail right now.";
      setAiTestError(message);
    } finally {
      setIsLoadingAttemptDetail(false);
    }
  }

  async function handleSubmitTest() {
    if (!courseDetails || !journey || testQuestions.length === 0 || !activeUserTestId) {
      return;
    }

    const hasUnanswered = testQuestions.some((question) => {
      const response = testResponses[question.id];
      if (!response) {
        return true;
      }
      if (question.question_type === "fill_blank" || question.question_type === "short_answer") {
        return response.answerText.trim().length === 0;
      }
      return response.selectedOptionIndex === null || response.selectedOptionIndex === undefined;
    });

    if (hasUnanswered) {
      setAiTestError("Please answer all test questions before submitting.");
      playSound("error");
      return;
    }

    setIsSubmittingTest(true);
    setAiTestError("");
    setActionMessage("");
    setTestFeedback("");
    setTestResult(null);
    setShowResultPopup(false);
    setResultPopupPayload(null);

    try {
      const response = await fetch("/api/course/test/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_test_id: activeUserTestId,
          course_id: courseDetails.id,
          journey_path_id: journey.journey_path_id,
          selected_resource_id: selectedResourceId || undefined,
          answers: testQuestions.map((question) => ({
            question_id: question.id,
            selected_option_index:
              question.question_type === "multiple_choice"
                ? testResponses[question.id]?.selectedOptionIndex ?? undefined
                : undefined,
            user_answer_text:
              question.question_type === "multiple_choice"
                ? testResponses[question.id]?.selectedOptionIndex !== null &&
                  testResponses[question.id]?.selectedOptionIndex !== undefined
                  ? question.options[testResponses[question.id]?.selectedOptionIndex ?? -1] ?? ""
                  : ""
                : testResponses[question.id]?.answerText ?? "",
          })),
        }),
      });

      const payload = (await response.json()) as CourseTestSubmitApiResponse;
      if (!response.ok || !payload.success || !payload.result) {
        throw new Error(payload.message ?? "Unable to submit AI test right now.");
      }

      const reviewResult: AiTestReviewResult = {
        ...payload.result,
        graded_at: payload.result.graded_at ?? new Date().toISOString(),
      };
      const previousStatusByCourseId = new Map(
        (journey?.nodes ?? []).map((node) => [node.course_id, node.status] as const),
      );
      const newlyUnlockedIds = reviewResult.journey?.nodes
        ? reviewResult.journey.nodes
        .filter((node) => {
          const previousStatus = previousStatusByCourseId.get(node.course_id);
          if (!previousStatus) {
            return false;
          }
          return (
            previousStatus === "locked" &&
            (node.status === "unlocked" ||
              node.status === "in_progress" ||
              node.status === "ready_for_test")
          );
        })
        .map((node) => node.course_id)
        : [];
      const newlyPassedIds = reviewResult.journey?.nodes
        ? reviewResult.journey.nodes
        .filter((node) => {
          const previousStatus = previousStatusByCourseId.get(node.course_id);
          return node.status === "passed" && previousStatus !== "passed";
        })
        .map((node) => node.course_id)
        : [];
      triggerNodePop([...newlyPassedIds, ...newlyUnlockedIds]);

      if (reviewResult.journey) {
        setJourney(reviewResult.journey);
        emitProgress(reviewResult.journey, "mutation");
      }

      if (reviewResult.passed) {
        setActionMessage(`Great work. You passed with ${reviewResult.score}/100.`);
        setTestFeedback(reviewResult.feedback_summary);
        playSound("complete");
        if (newlyUnlockedIds.length > 0) {
          playSound("unlock");
        }
      } else {
        setActionMessage(
          `You scored ${reviewResult.score}/100. You need ${reviewResult.required_score} to pass this course.`,
        );
        setTestFeedback(
          "Review current resource. Try another resource. Retake test later.",
        );
        playSound("failure");
      }

      await loadCourseDetails(courseDetails.id, {
        preserveAiTestState: true,
        keepSelectedResource: true,
      });
      setTestResult(reviewResult);
      setAiTestMode("graded");
      setActiveUserTestId(reviewResult.user_test_id);

      const popupMessage = getScoreBandMessage(reviewResult.score);
      const popupFeedback = getScoreBandFeedback(reviewResult.score);
      setResultPopupPayload({
        score: reviewResult.score,
        passed: reviewResult.passed,
        feedback: popupFeedback,
        emoji: getScoreBandEmoji(reviewResult.score),
        message: popupMessage,
      });
      setShowResultPopup(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit AI test right now.";
      setAiTestError(message);
    } finally {
      setIsSubmittingTest(false);
    }
  }

  async function handleStartNewTest() {
    setAiTestError("");
    setShowResultPopup(false);
    setResultPopupPayload(null);
    await handlePrepareTest({ forceNewAttempt: true });
  }

  async function handleSubmitRating(resourceId: string) {
    const rating = ratingDraft[resourceId] ?? 0;
    if (rating < 1 || rating > 5) {
      setCourseError("Please choose a rating between 1 and 5.");
      return;
    }

    setIsSubmittingResourceAction(true);
    setCourseError("");

    try {
      const response = await fetch("/api/resource/rating", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resource_id: resourceId,
          rating,
        }),
      });
      const payload = (await response.json()) as RatingApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to submit rating right now.");
      }

      if (courseDetails) {
        await loadCourseDetails(courseDetails.id, {
          preserveAiTestState: true,
          keepSelectedResource: true,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to submit rating right now.";
      setCourseError(message);
    } finally {
      setIsSubmittingResourceAction(false);
    }
  }

  async function handleSubmitComment(resourceId: string) {
    const commentText = (commentDraft[resourceId] ?? "").trim();
    if (!commentText) {
      setCourseError("Comment cannot be empty.");
      return;
    }

    setIsSubmittingResourceAction(true);
    setCourseError("");

    try {
      const response = await fetch("/api/resource/comment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resource_id: resourceId,
          comment_text: commentText,
        }),
      });
      const payload = (await response.json()) as CommentApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to submit comment right now.");
      }

      setCommentDraft((previous) => ({
        ...previous,
        [resourceId]: "",
      }));

      if (courseDetails) {
        await loadCourseDetails(courseDetails.id, {
          preserveAiTestState: true,
          keepSelectedResource: true,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to submit comment right now.";
      setCourseError(message);
    } finally {
      setIsSubmittingResourceAction(false);
    }
  }

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
            {folder.name}
          </p>
          <h2 className="mt-4 text-3xl font-extrabold text-[#1F2937]">Learning Journey</h2>
          <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
            Start: {folder.currentLevel} · Destination: {folder.targetLevel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadJourney({
              reason: "manual_refresh",
              force: true,
            });
          }}
          className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm"
        >
          Refresh
        </button>
      </div>

      {journeyError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {journeyError}
        </p>
      ) : null}

      {isLoadingJourney ? (
        <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-5 text-sm font-semibold text-[#1F2937]/70">
          {panelState === "generating_journey"
            ? "Generating your journey..."
            : "Loading your learning journey..."}
        </div>
      ) : null}

      {!isLoadingJourney && journey ? (
        <>
          <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F6FCFF] p-4">
            <p className="text-sm font-extrabold text-[#1F2937]">
              Steps completed: {completedCount}/{journey.total_steps}
            </p>
            <div className="mt-2 h-3 rounded-full bg-[#1F2937]/10">
              <div
                className="h-full rounded-full bg-[#58CC02] transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <p className="mt-2 text-xs font-semibold text-[#1F2937]/65">
              Current step: {journey.current_step} of {journey.total_steps}
            </p>
          </div>

          <div className="mt-7 max-h-[620px] overflow-y-auto pr-1 sm:mt-8">
            <div className="flex flex-col items-center pt-2 sm:pt-3">
              {journey.nodes.map((node, index) => {
                const nextNode = journey.nodes[index + 1];
                const isLocked = node.status === "locked";
                const shouldPop = poppingNodeIds.includes(node.course_id);

                return (
                  <div key={node.course_id} className="flex flex-col items-center">
                    <div className="journey-node-coin-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          void handleNodeClick(node);
                        }}
                        className={`${getNodeClassName(node.status, { pop: shouldPop })} journey-node-coin`}
                        aria-label={`${node.title} ${node.status}`}
                      >
                        {node.status === "passed" ? "✓" : node.step_number}
                        {isLocked ? (
                          <span className="absolute -right-1 -top-1 rounded-full bg-[#6B7280] px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                            🔒
                          </span>
                        ) : null}
                        {node.passed_score ? (
                          <span
                            className={`absolute -right-2 -top-2 rounded-full border-2 border-[#1F2937] px-1.5 py-0.5 text-[10px] font-extrabold text-white ${
                              node.passed_score >= 60 ? "bg-[#58CC02]" : "bg-[#9CA3AF]"
                            }`}
                          >
                            {node.passed_score}
                          </span>
                        ) : null}
                      </button>
                    </div>
                    <p className="mt-2 max-w-[180px] text-center text-xs font-semibold text-[#1F2937]/70">
                      {node.title}
                    </p>

                    {nextNode ? (
                      <div className="my-2 flex flex-col items-center gap-1.5">
                        <span className={getConnectorClassName(node.status, nextNode.status)} />
                        <span className={getConnectorClassName(node.status, nextNode.status)} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {isCourseModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            {isLoadingCourse ? (
              <p className="rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
                Loading course details...
              </p>
            ) : null}

            {courseError ? (
              <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {courseError}
              </p>
            ) : null}

            {courseDetails ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-2xl font-extrabold text-[#1F2937]">{courseDetails.title}</h3>
                    <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
                      {courseDetails.description ?? "No description available yet."}
                    </p>
                    <div className="mt-1 text-xs font-semibold text-[#DC2626]">
                      <span>Weakness: </span>
                      {courseDetails.weakness_concepts && courseDetails.weakness_concepts.length > 0 ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {courseDetails.weakness_concepts.map((concept) => (
                            <button
                              key={concept}
                              type="button"
                              onClick={() =>
                                router.push(
                                  `/dashboard/weakness/${encodeURIComponent(courseDetails.id)}/${encodeURIComponent(concept)}`,
                                )
                              }
                              className="inline-flex items-center rounded-full border border-[#DC2626]/35 bg-[#fff1f1] px-2 py-0.5 text-[11px] font-semibold text-[#B91C1C] transition hover:bg-[#ffe4e4]"
                            >
                              {concept}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <span>none</span>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-bold uppercase tracking-wide text-[#1F2937]/60">
                      Estimated time: {courseDetails.estimated_minutes ?? 30} minutes
                    </p>
                    {courseDetails.difficulty_level ? (
                      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[#1F2937]/60">
                        Difficulty: {formatCourseDifficultyLabel(courseDetails.difficulty_level)}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs font-bold uppercase tracking-wide text-[#1F2937]/65">
                      Status: {courseDetails.status.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[#1F2937]/65">
                      Latest score: {courseDetails.last_test_score ?? "Not tested yet"} · Best passed score:{" "}
                      {courseDetails.best_test_score ?? "Not passed yet"}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-[#1F2937]/65">
                      Pass requirement: {courseDetails.required_test_score}+
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (courseDetails.status === "ready_for_test") {
                        void handlePrepareTest();
                        return;
                      }
                      void handleStartCourse();
                    }}
                    disabled={
                      isStartingCourse ||
                      isPreparingTest ||
                      (courseDetails.status !== "ready_for_test" && !selectedResourceId)
                    }
                    className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {courseDetails.status === "ready_for_test"
                      ? isPreparingTest
                        ? "Preparing test..."
                        : getPrimaryLearnActionLabel(courseDetails.status)
                      : isStartingCourse
                      ? "Opening..."
                      : getPrimaryLearnActionLabel(courseDetails.status)}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {courseDetails.status === "ready_for_test" ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleStartCourse();
                      }}
                      disabled={isStartingCourse || !selectedResourceId}
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Continue learning
                    </button>
                  ) : null}
                  {courseDetails.can_take_test && courseDetails.status !== "passed" && courseDetails.status !== "ready_for_test" ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handlePrepareTest();
                      }}
                      disabled={isPreparingTest || isSubmittingTest}
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isPreparingTest ? "Preparing test..." : "Take AI Test"}
                    </button>
                  ) : null}
                  {(activeAiTest?.courseId === courseDetails.id &&
                    (testQuestions.length > 0 || testResult)) ||
                  hasAnyPreviousTestAttempts ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAiTestError("");
                        const hasLocalPreparedTest =
                          activeAiTest?.courseId === courseDetails.id &&
                          (testQuestions.length > 0 || testResult);
                        if (hasLocalPreparedTest) {
                          setIsAiTestModalOpen(true);
                          return;
                        }

                        setActiveAiTest({
                          courseId: courseDetails.id,
                          courseTitle: courseDetails.title,
                        });
                        setIsAiTestModalOpen(true);
                        void handleLoadAttemptHistory({ openFirstAttempt: true });
                      }}
                      disabled={isSubmittingTest || isCheckingPreviousTests}
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isCheckingPreviousTests
                        ? "Checking..."
                        : hasAnyPreviousTestAttempts
                        ? "Previous AI Test"
                        : "Open AI Test"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-4">
                  {courseDetails.resources.slice(0, 3).map((resource, index) => (
                    <article
                      key={resource.id}
                      className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4"
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="radio"
                          name="selected-resource"
                          value={resource.id}
                          checked={selectedResourceId === resource.id}
                          onChange={() => setSelectedResourceId(resource.id)}
                          className="mt-1 h-4 w-4 accent-[#58CC02]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-extrabold text-[#1F2937]">
                            {index + 1}. {resource.title}
                          </p>
                          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[#1F2937]/60">
                            {formatResourceType(resource.resource_type)} · {resource.provider}
                          </p>
                          <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">
                            {resource.summary ?? "No summary available."}
                          </p>
                          <p className="mt-2 text-xs font-semibold text-[#1F2937]/65">
                            Rating: {resource.average_rating.toFixed(1)} / 5 · Comments: {resource.comment_count}
                          </p>
                        </div>
                      </label>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          value={ratingDraft[resource.id] ?? resource.my_rating ?? ""}
                          onChange={(event) =>
                            setRatingDraft((previous) => ({
                              ...previous,
                              [resource.id]: Number(event.target.value),
                            }))
                          }
                          className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                        >
                          <option value="">Rate resource</option>
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                          <option value={5}>5</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            void handleSubmitRating(resource.id);
                          }}
                          disabled={isSubmittingResourceAction}
                          className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Save Rating
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={commentDraft[resource.id] ?? ""}
                          onChange={(event) =>
                            setCommentDraft((previous) => ({
                              ...previous,
                              [resource.id]: event.target.value,
                            }))
                          }
                          className="min-w-[220px] flex-1 rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                          placeholder="Leave a comment"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleSubmitComment(resource.id);
                          }}
                          disabled={isSubmittingResourceAction}
                          className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Post Comment
                        </button>
                      </div>

                      {resource.comment_previews.length > 0 ? (
                        <div className="mt-3 space-y-1">
                          {resource.comment_previews.map((comment) => (
                            <p
                              key={comment.id}
                              className="text-xs font-semibold text-[#1F2937]/70"
                            >
                              {comment.username ?? "Learner"}: {comment.comment_text} ·{" "}
                              {formatDateTime(comment.created_at)}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>

                {actionMessage ? (
                  <p className="mt-4 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
                    {actionMessage}
                  </p>
                ) : null}

                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={
                      isStartingCourse ||
                      isPreparingTest ||
                      isSubmittingTest ||
                      isSubmittingResourceAction ||
                      isAiTestModalOpen
                    }
                    className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {isCourseModalOpen && isAiTestModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4 motion-modal-overlay">
          <div className="relative w-full max-w-5xl rounded-[2rem] border-2 border-[#1F2937] bg-white shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] motion-modal-content">
            <div className="flex items-center justify-between gap-3 border-b-2 border-[#1F2937]/10 px-6 py-4">
              <div>
                <h3 className="text-2xl font-extrabold text-[#1F2937]">AI Quick Test</h3>
                <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
                  {activeAiTest?.courseTitle ?? courseDetails?.title ?? "Course"} ·{" "}
                  {aiTestMode === "taking" ? `${testQuestions.length} questions` : "Graded paper"} · Pass score {requiredTestScore}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAiTestModal}
                disabled={isPreparingTest || isSubmittingTest}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                Back to Course
              </button>
            </div>

            {showResultPopup && resultPopupPayload ? (
              <div className="absolute right-6 top-6 z-20 w-[min(92vw,360px)]">
                <div
                  className={`rounded-3xl border-2 border-[#1F2937] px-4 py-4 shadow-[0_8px_0_#1F2937,0_14px_24px_rgba(31,41,55,0.18)] ${
                    resultPopupPayload.passed ? "bg-[#ECFFE1]" : "bg-[#FFE3E3]"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  <button
                    type="button"
                    onClick={dismissResultPopup}
                    className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#1F2937]/20 bg-white/80 text-base font-extrabold text-[#1F2937] transition hover:bg-white"
                    aria-label="Close result popup"
                  >
                    ×
                  </button>

                  <div className="pr-8">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/70">
                      AI Test Result
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1F2937]/20 bg-white text-2xl">
                        {resultPopupPayload.emoji}
                      </span>
                      <div>
                        <p className="text-xl font-extrabold text-[#1F2937]">
                          Mark: {resultPopupPayload.score}
                        </p>
                        <p className="text-sm font-semibold text-[#1F2937]/80">
                          {resultPopupPayload.feedback}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-[#1F2937]/75">
                      {resultPopupPayload.message}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
              {aiTestError ? (
                <p className="rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                  {aiTestError}
                </p>
              ) : null}

              {aiTestMode === "taking" && testQuestions.length > 0 ? (
                <div className="space-y-4">
                  {testQuestions.map((question, questionIndex) => (
                    <article
                      key={question.id}
                      className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4"
                    >
                      <p className="text-sm font-extrabold text-[#1F2937]">
                        Q{question.question_order || questionIndex + 1}. {question.question_text}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[#1F2937]/65">
                        Score: {question.score}
                      </p>

                      {question.question_type === "fill_blank" ? (
                        <div className="mt-3">
                          <input
                            type="text"
                            value={testResponses[question.id]?.answerText ?? ""}
                            onChange={(event) =>
                              updateTestTextAnswer(question.id, event.target.value)
                            }
                            className="w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                            placeholder="Type your answer"
                          />
                        </div>
                      ) : question.question_type === "short_answer" ? (
                        <div className="mt-3">
                          <textarea
                            value={testResponses[question.id]?.answerText ?? ""}
                            onChange={(event) =>
                              updateTestTextAnswer(question.id, event.target.value)
                            }
                            rows={7}
                            className="w-full resize-y rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                            placeholder="Write your answer here"
                          />
                        </div>
                      ) : (
                        <div className="mt-3 space-y-1.5">
                          {question.options.map((option, optionIndex) => (
                            <label
                              key={`${question.id}-${optionIndex}`}
                              className="flex items-center gap-2 text-xs font-semibold text-[#1F2937]/80"
                            >
                              <input
                                type="radio"
                                name={`ai-question-${question.id}`}
                                checked={
                                  testResponses[question.id]?.selectedOptionIndex === optionIndex
                                }
                                onChange={() => updateTestChoiceAnswer(question.id, optionIndex)}
                                className="h-4 w-4 accent-[#58CC02]"
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : null}

              {aiTestMode === "taking" && testQuestions.length === 0 ? (
                <p className="rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
                  Test content is not available yet.
                </p>
              ) : null}

              {aiTestMode === "history" ? (
                <div className="mb-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-extrabold text-[#1F2937]">Previous Attempts</p>
                    {isLoadingAttemptHistory ? (
                      <span className="text-xs font-semibold text-[#1F2937]/70">Loading...</span>
                    ) : null}
                  </div>
                  {attemptHistory.length === 0 && !isLoadingAttemptHistory ? (
                    <p className="mt-2 text-xs font-semibold text-[#1F2937]/70">
                      No previous graded attempts yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {attemptHistory.map((attempt) => (
                        <button
                          key={attempt.user_test_id}
                          type="button"
                          onClick={() => {
                            void handleLoadAttemptDetail(attempt.user_test_id);
                          }}
                          disabled={isLoadingAttemptDetail}
                          className={`w-full rounded-xl border-2 px-3 py-2 text-left text-xs font-semibold transition ${
                            activeUserTestId === attempt.user_test_id
                              ? "border-[#58CC02] bg-[#ECFFE1] text-[#1F2937]"
                              : "border-[#1F2937]/12 bg-white text-[#1F2937]/80 hover:bg-[#F5F9FF]"
                          } disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          Attempt {attempt.attempt_number} · {attempt.earned_score}/{attempt.total_score} ·{" "}
                          {attempt.pass_status === "passed" ? "Passed" : "Failed"} ·{" "}
                          {attempt.graded_at ? formatDateTime(attempt.graded_at) : "Unknown time"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {testFeedback ? (
                <p className="mt-4 rounded-xl bg-[#F0F9FF] px-3 py-2 text-sm font-semibold text-[#1F2937]/80">
                  {testFeedback}
                </p>
              ) : null}

              {(aiTestMode === "graded" || aiTestMode === "history") && testResult ? (
                <div className="mt-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-extrabold text-[#1F2937]">Graded Paper Review</p>
                      <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                        Attempt {testResult.attempt_number}
                        {testResult.graded_at ? ` · ${formatDateTime(testResult.graded_at)}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-extrabold text-[#1F2937]">
                        Mark: {testResult.earned_score}/{testResult.total_score}
                      </p>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide ${
                          testResult.passed
                            ? "bg-[#58CC02] text-white"
                            : "bg-[#FCA5A5] text-[#7f1d1d]"
                        }`}
                      >
                        {testResult.passed ? "Passed" : "Failed"}
                      </span>
                    </div>
                  </div>

                  <p className="mt-3 text-sm font-semibold text-[#1F2937]/80">
                    {testResult.feedback_summary}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#1F2937]/75">
                    {testResult.course_completed
                      ? "Course completed successfully."
                      : "Course not completed. Continue learning and try another attempt."}
                  </p>

                  <div className="mt-4 space-y-2">
                    {testResult.question_results.map((item) => (
                      <article
                        key={item.question_id}
                        className="rounded-xl border-2 border-[#1F2937]/10 bg-white p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-extrabold text-[#1F2937]">
                            Q{item.question_order}. {item.question_text}
                          </p>
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-extrabold ${
                              item.result_status === "correct"
                                ? "border-[#1F2937] bg-[#58CC02] text-white"
                                : item.result_status === "partial"
                                ? "border-[#1F2937] bg-[#FACC15] text-[#1F2937]"
                                : "border-[#1F2937] bg-[#FCA5A5] text-[#7f1d1d]"
                            }`}
                          >
                            {getResultStatusIcon(item.result_status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                          Your answer: {item.user_answer || "(empty)"}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                          Correct answer: {item.correct_answer || "N/A"}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                          Score: {item.earned_score}/{item.max_score}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                          {item.explanation}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}

              {(aiTestMode === "graded" || aiTestMode === "history") && !testResult ? (
                <p className="rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
                  No graded paper loaded yet.
                </p>
              ) : null}

              {isLoadingAttemptDetail ? (
                <p className="mt-3 text-xs font-semibold text-[#1F2937]/70">
                  Loading selected attempt...
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t-2 border-[#1F2937]/10 px-6 py-4">
              {aiTestMode === "taking" ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleSubmitTest();
                  }}
                  disabled={isSubmittingTest || testQuestions.length === 0 || testResult !== null}
                  className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmittingTest ? "Submitting..." : "Submit Test"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void handleLoadAttemptHistory({ openFirstAttempt: true });
                    }}
                    disabled={isLoadingAttemptHistory || isLoadingAttemptDetail}
                    className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isLoadingAttemptHistory ? "Loading..." : "Previous Tests with Answers"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleStartNewTest();
                    }}
                    disabled={isPreparingTest || isSubmittingTest}
                    className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isPreparingTest ? "Preparing..." : "Start New Test"}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={closeAiTestModal}
                disabled={isPreparingTest || isSubmittingTest}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
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


