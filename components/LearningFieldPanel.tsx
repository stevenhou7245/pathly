"use client";

import type { LearningFolder } from "@/components/dashboardData";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatCourseDifficultyLabel,
  type CourseDifficultyLevel,
} from "@/lib/courseDifficulty";
import { playSound, type SoundKey } from "@/lib/sound";

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
  is_locked?: boolean;
  is_completed?: boolean;
  latest_score?: number | null;
  best_score?: number | null;
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
  resource_generation_status: "pending" | "generating" | "ready" | "failed";
  is_resource_generated: boolean;
  resources_generated_at: string | null;
  resources: CourseResource[];
};

type CourseApiResponse = {
  success: boolean;
  message?: string;
  course?: CourseDetails;
};

type CourseWeaknessApiResponse = {
  success: boolean;
  message?: string;
  weakness_concepts?: Array<string | null>;
};

type WeaknessDrillQuestion = {
  id: string;
  question_order: number;
  question_type: "multiple_choice" | "fill_blank" | "short_answer";
  question_text: string;
  options: string[];
  correct_answer: string;
  acceptable_answers: string[];
  explanation: string;
  score: number;
  concept_tags: string[];
  skill_tags: string[];
};

type WeaknessConceptDrill = {
  concept_tag: string;
  concept_label: string;
  concept_explanation: string;
  resources: Array<{
    title: string;
    url: string;
    summary: string;
    provider: string;
  }>;
  test: {
    weakness_test_session_id: string;
    required_score: number;
    metadata: {
      generated_at: string;
      total_questions: number;
      objective_questions: number;
      multiple_choice_questions: number;
      fill_blank_questions: number;
      total_score: number;
      reused_existing: boolean;
      fallback_used: boolean;
    };
    questions: WeaknessDrillQuestion[];
  } | null;
};

type WeaknessConceptDrillApiResponse = {
  success: boolean;
  message?: string;
  drill?: WeaknessConceptDrill;
};

type WeaknessDrillSubmitApiResponse = {
  success: boolean;
  message?: string;
  result?: {
    weakness_test_session_id: string;
    score?: number;
    max_score?: number;
    earned_score: number;
    total_score: number;
    required_score: number;
    passed: boolean;
    resolved: boolean;
    resolved_concept_tag?: string | null;
  };
  score?: number;
  max_score?: number;
  passed?: boolean;
  resolved_concept_tag?: string | null;
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

type TransitionReviewQuestion = {
  question_index: number;
  question_type: "single_choice" | "fill_blank" | "short_answer";
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

type TransitionReviewPopupApiResponse = {
  success: boolean;
  message?: string;
  popup?: {
    should_show: boolean;
    review_id: string | null;
    from_course_id: string | null;
    to_course_id: string | null;
    instructions: string;
    questions: TransitionReviewQuestion[];
  };
};

type TransitionReviewSubmitApiResponse = {
  success: boolean;
  message?: string;
  result?: {
    review_id: string;
    selected_action: "continue" | "go_back";
    score: number | null;
    total_questions: number;
    correct_count: number;
    performance: "good" | "weak";
    evaluations: Array<{
      question_index: number;
      user_answer: string;
      is_correct: boolean;
      correct_answer: string;
      explanation: string;
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
const AI_TEST_PASSING_SCORE = 80;
const WEAKNESS_TEST_PASSING_SCORE = 90;
const JOURNEY_NODES_INITIAL_VISIBLE = 12;
const JOURNEY_NODES_VISIBLE_STEP = 8;
type PendingAiTestResultSound = {
  primary: Extract<SoundKey, "complete" | "failure">;
  playUnlock: boolean;
  score: number;
  passed: boolean;
};

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
    return "Great job!";
  }
  if (score >= 80) {
    return "Good!";
  }
  return "Keep learning~";
}

function formatConceptLabel(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function normalizeWeaknessConceptKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

function getJourneyNodeIdentity(node: JourneyNode) {
  return `${node.step_number}:${node.course_id}`;
}

function resolveJourneyNodeState(node: JourneyNode) {
  const explicitLocked = typeof node.is_locked === "boolean" ? node.is_locked : null;
  const explicitCompleted = typeof node.is_completed === "boolean" ? node.is_completed : null;
  const isLocked = explicitLocked ?? node.status === "locked";
  const isCompleted = explicitCompleted ?? node.status === "passed";
  const status: CourseNodeStatus = isLocked ? "locked" : isCompleted ? "passed" : node.status;
  const canOpen = !isLocked && Boolean(node.course_id?.trim());
  const latestScore = typeof node.latest_score === "number" ? node.latest_score : null;
  const bestScore =
    typeof node.best_score === "number"
      ? node.best_score
      : typeof node.passed_score === "number"
      ? node.passed_score
      : null;
  const showScoreBadge =
    !isLocked &&
    ((isCompleted && bestScore !== null) || (!isCompleted && latestScore !== null));
  const scoreBadgeValue = isCompleted ? bestScore : latestScore;

  return {
    status,
    isLocked,
    isCompleted,
    canOpen,
    latestScore,
    bestScore,
    showScoreBadge,
    scoreBadgeValue,
  };
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
  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [panelState, setPanelState] = useState<RightPanelState>("idle");
  const [isLoadingJourney, setIsLoadingJourney] = useState(true);
  const [journeyError, setJourneyError] = useState("");

  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [courseDetails, setCourseDetails] = useState<CourseDetails | null>(null);
  const [isLoadingCourse, setIsLoadingCourse] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [weaknessConcepts, setWeaknessConcepts] = useState<string[]>([]);
  const [isLoadingWeakness, setIsLoadingWeakness] = useState(false);
  const [weaknessError, setWeaknessError] = useState("");
  const [isWeaknessDrillModalOpen, setIsWeaknessDrillModalOpen] = useState(false);
  const [isLoadingWeaknessDrill, setIsLoadingWeaknessDrill] = useState(false);
  const [weaknessDrillError, setWeaknessDrillError] = useState("");
  const [activeWeaknessConcept, setActiveWeaknessConcept] = useState("");
  const [weaknessDrillData, setWeaknessDrillData] = useState<WeaknessConceptDrill | null>(null);
  const [isGeneratingWeaknessTest, setIsGeneratingWeaknessTest] = useState(false);
  const [showWeaknessPractice, setShowWeaknessPractice] = useState(false);
  const [weaknessPracticeResponses, setWeaknessPracticeResponses] = useState<
    Record<string, { selectedOptionIndex: number | null; answerText: string }>
  >({});
  const [weaknessPracticeResult, setWeaknessPracticeResult] = useState<{
    earnedScore: number;
    totalScore: number;
    passed: boolean;
  } | null>(null);
  const [showWeaknessResultPopup, setShowWeaknessResultPopup] = useState(false);
  const [weaknessResultPopupPayload, setWeaknessResultPopupPayload] = useState<{
    score: number;
    passed: boolean;
    feedback: string;
    emoji: string;
    message: string;
  } | null>(null);
  const [pendingWeaknessResultSound, setPendingWeaknessResultSound] = useState<PendingAiTestResultSound | null>(
    null,
  );
  const [isResolvingWeakness, setIsResolvingWeakness] = useState(false);
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
  const [requiredTestScore, setRequiredTestScore] = useState(AI_TEST_PASSING_SCORE);
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
  const [pendingAiTestResultSound, setPendingAiTestResultSound] = useState<PendingAiTestResultSound | null>(null);
  const [hasAnyPreviousTestAttempts, setHasAnyPreviousTestAttempts] = useState(false);
  const [ratingDraft, setRatingDraft] = useState<Record<string, number>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [isSubmittingResourceAction, setIsSubmittingResourceAction] = useState(false);
  const [isTransitionReviewModalOpen, setIsTransitionReviewModalOpen] = useState(false);
  const [isLoadingTransitionReview, setIsLoadingTransitionReview] = useState(false);
  const [isSubmittingTransitionReview, setIsSubmittingTransitionReview] = useState(false);
  const [transitionReviewError, setTransitionReviewError] = useState("");
  const [transitionReviewPopup, setTransitionReviewPopup] = useState<{
    review_id: string;
    from_course_id: string;
    to_course_id: string;
    instructions: string;
    questions: TransitionReviewQuestion[];
  } | null>(null);
  const [transitionReviewAnswers, setTransitionReviewAnswers] = useState<Record<number, string>>({});
  const [transitionReviewResult, setTransitionReviewResult] = useState<{
    score: number | null;
    total_questions: number;
    correct_count: number;
    performance: "good" | "weak";
    evaluations: Array<{
      question_index: number;
      user_answer: string;
      is_correct: boolean;
      correct_answer: string;
      explanation: string;
    }>;
  } | null>(null);
  const [poppingNodeIds, setPoppingNodeIds] = useState<string[]>([]);
  const [flippingNodeIds, setFlippingNodeIds] = useState<string[]>([]);
  const [visibleJourneyNodeCount, setVisibleJourneyNodeCount] = useState(JOURNEY_NODES_INITIAL_VISIBLE);
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
  const visibleJourneyNodes = useMemo(
    () => journey?.nodes.slice(0, visibleJourneyNodeCount) ?? [],
    [journey?.nodes, visibleJourneyNodeCount],
  );
  const formattedWeaknessConcepts = useMemo(
    () =>
      weaknessConcepts
        .map((concept) => concept.trim())
        .filter(Boolean)
        .map((concept) => ({
          raw: concept,
          label: formatConceptLabel(concept),
        })),
    [weaknessConcepts],
  );

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

  useEffect(() => {
    setVisibleJourneyNodeCount(JOURNEY_NODES_INITIAL_VISIBLE);
  }, [folder.id, journey?.journey_path_id]);

  useEffect(() => {
    if (!showResultPopup || !resultPopupPayload || !pendingAiTestResultSound) {
      return;
    }
    playSound(pendingAiTestResultSound.primary);
    console.info("[audio] ai_test_result_sound:played", {
      sound: pendingAiTestResultSound.primary,
      score: pendingAiTestResultSound.score,
      passed: pendingAiTestResultSound.passed,
      popup_open: showResultPopup,
      trigger: "result_popup_visible",
    });
    if (pendingAiTestResultSound.playUnlock) {
      playSound("unlock");
      console.info("[audio] ai_test_result_sound:played", {
        sound: "unlock",
        score: pendingAiTestResultSound.score,
        passed: pendingAiTestResultSound.passed,
        popup_open: showResultPopup,
        trigger: "result_popup_visible",
      });
    }
    setPendingAiTestResultSound(null);
  }, [pendingAiTestResultSound, resultPopupPayload, showResultPopup]);

  useEffect(() => {
    if (!showWeaknessResultPopup || !weaknessResultPopupPayload || !pendingWeaknessResultSound) {
      return;
    }
    playSound(pendingWeaknessResultSound.primary);
    console.info("[audio] weakness_test_result_sound:played", {
      sound: pendingWeaknessResultSound.primary,
      score: pendingWeaknessResultSound.score,
      passed: pendingWeaknessResultSound.passed,
      popup_open: showWeaknessResultPopup,
      trigger: "result_popup_visible",
    });
    if (pendingWeaknessResultSound.playUnlock) {
      playSound("unlock");
      console.info("[audio] weakness_test_result_sound:played", {
        sound: "unlock",
        score: pendingWeaknessResultSound.score,
        passed: pendingWeaknessResultSound.passed,
        popup_open: showWeaknessResultPopup,
        trigger: "result_popup_visible",
      });
    }
    setPendingWeaknessResultSound(null);
  }, [pendingWeaknessResultSound, showWeaknessResultPopup, weaknessResultPopupPayload]);

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

  const triggerNodeFlip = useCallback((courseId: string) => {
    const normalizedId = courseId.trim();
    if (!normalizedId) {
      return;
    }
    setFlippingNodeIds((previous) => {
      if (previous.includes(normalizedId)) {
        return previous;
      }
      return [...previous, normalizedId];
    });
  }, []);

  const clearNodeFlip = useCallback((courseId: string) => {
    const normalizedId = courseId.trim();
    if (!normalizedId) {
      return;
    }
    setFlippingNodeIds((previous) => previous.filter((id) => id !== normalizedId));
  }, []);

  const resetTransitionReviewState = useCallback(() => {
    setIsTransitionReviewModalOpen(false);
    setIsLoadingTransitionReview(false);
    setIsSubmittingTransitionReview(false);
    setTransitionReviewError("");
    setTransitionReviewPopup(null);
    setTransitionReviewAnswers({});
    setTransitionReviewResult(null);
  }, []);

  const resolveTransitionReviewPair = useCallback(
    (targetNode: JourneyNode) => {
      if (!journey) {
        return null;
      }
      const index = journey.nodes.findIndex(
        (node) =>
          node.course_id === targetNode.course_id && node.step_number === targetNode.step_number,
      );
      if (index <= 0) {
        return null;
      }
      const toNode = journey.nodes[index] ?? null;
      const fromNode = journey.nodes[index - 1] ?? null;
      if (!toNode || !fromNode) {
        return null;
      }
      return {
        toNode,
        fromNode,
      };
    },
    [journey],
  );

  const shouldInterceptTransitionReview = useCallback(
    (node: JourneyNode) => {
      if (!journey) {
        return false;
      }
      const nodeState = resolveJourneyNodeState(node);
      if (nodeState.status !== "unlocked") {
        return false;
      }
      if (node.step_number !== journey.current_step) {
        return false;
      }
      const pair = resolveTransitionReviewPair(node);
      if (!pair) {
        return false;
      }
      return resolveJourneyNodeState(pair.fromNode).isCompleted;
    },
    [journey, resolveTransitionReviewPair],
  );

  useEffect(() => {
    if (!journey) {
      return;
    }
    console.info("[journey_ui] resolved_nodes_preview", {
      journey_path_id: journey.journey_path_id,
      total_nodes: journey.nodes.length,
      nodes: journey.nodes.slice(0, 10).map((node) => {
        const state = resolveJourneyNodeState(node);
        return {
          course_id: node.course_id,
          step_number: node.step_number,
          title: node.title,
          status: state.status,
          is_locked: state.isLocked,
          is_completed: state.isCompleted,
          latest_score: state.latestScore,
          best_score: state.bestScore,
          show_score_badge: state.showScoreBadge,
        };
      }),
    });
  }, [journey]);

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
    setWeaknessConcepts([]);
    setIsLoadingWeakness(false);
    setWeaknessError("");
    setIsWeaknessDrillModalOpen(false);
    setIsLoadingWeaknessDrill(false);
    setWeaknessDrillError("");
    setActiveWeaknessConcept("");
    setWeaknessDrillData(null);
    setIsGeneratingWeaknessTest(false);
    setShowWeaknessPractice(false);
    setWeaknessPracticeResponses({});
    setWeaknessPracticeResult(null);
    setShowWeaknessResultPopup(false);
    setWeaknessResultPopupPayload(null);
    setPendingWeaknessResultSound(null);
    setIsResolvingWeakness(false);
    setIsAiTestModalOpen(false);
    setAiTestError("");
    setActiveAiTest(null);
    setActionMessage("");
    setSelectedResourceId("");
    setTestQuestions([]);
    setActiveUserTestId("");
    setTestResponses({});
    setRequiredTestScore(AI_TEST_PASSING_SCORE);
    setTestFeedback("");
    setTestResult(null);
    setAiTestMode("taking");
    setAttemptHistory([]);
    setShowResultPopup(false);
    setResultPopupPayload(null);
    setPendingAiTestResultSound(null);
    setHasAnyPreviousTestAttempts(false);
    setRatingDraft({});
    setCommentDraft({});
    resetTransitionReviewState();
  }, [folder.id, resetTransitionReviewState]);

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
      setWeaknessConcepts([]);
      setWeaknessError("");
      setIsWeaknessDrillModalOpen(false);
      setIsLoadingWeaknessDrill(false);
      setWeaknessDrillError("");
      setActiveWeaknessConcept("");
      setWeaknessDrillData(null);
      setIsGeneratingWeaknessTest(false);
      setShowWeaknessPractice(false);
      setWeaknessPracticeResponses({});
      setWeaknessPracticeResult(null);
      setShowWeaknessResultPopup(false);
      setWeaknessResultPopupPayload(null);
      setPendingWeaknessResultSound(null);
      setIsResolvingWeakness(false);

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
        setIsLoadingWeakness(true);
        setWeaknessError("");
        try {
          const weaknessResponse = await fetch(`/api/course/weakness/${encodeURIComponent(payload.course.id)}`, {
            method: "GET",
            cache: "no-store",
          });
          const weaknessPayload = (await weaknessResponse.json()) as CourseWeaknessApiResponse;
          if (!weaknessResponse.ok || !weaknessPayload.success) {
            throw new Error(weaknessPayload.message ?? "Unable to load weakness concepts.");
          }
          if (courseRequestIdRef.current === requestId) {
            const concepts = (weaknessPayload.weakness_concepts ?? [])
              .map((item) => (typeof item === "string" ? item.trim() : ""))
              .filter(Boolean);
            setWeaknessConcepts(concepts);
          }
        } catch (weaknessLoadError) {
          if (courseRequestIdRef.current === requestId) {
            const message =
              weaknessLoadError instanceof Error
                ? weaknessLoadError.message
                : "Unable to load weakness concepts.";
            setWeaknessConcepts([]);
            setWeaknessError(message);
          }
        } finally {
          if (courseRequestIdRef.current === requestId) {
            setIsLoadingWeakness(false);
          }
        }
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
          setRequiredTestScore(AI_TEST_PASSING_SCORE);
          setTestFeedback("");
          setTestResult(null);
          setAiTestMode("taking");
          setAttemptHistory([]);
          setShowResultPopup(false);
          setResultPopupPayload(null);
          setPendingAiTestResultSound(null);
        }
      } catch (error) {
        if (courseRequestIdRef.current !== requestId) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Unable to load course details right now.";
        setCourseError(message);
        setCourseDetails(null);
        setWeaknessConcepts([]);
        setIsLoadingWeakness(false);
        setWeaknessError("");
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

  const openCourseFromTransitionReview = useCallback(
    async (courseId: string) => {
      resetTransitionReviewState();
      await loadCourseDetails(courseId);
    },
    [loadCourseDetails, resetTransitionReviewState],
  );

  const openTransitionReviewForNode = useCallback(
    async (node: JourneyNode) => {
      if (!journey) {
        await loadCourseDetails(node.course_id);
        return;
      }

      const pair = resolveTransitionReviewPair(node);
      if (!pair) {
        await loadCourseDetails(node.course_id);
        return;
      }

      setIsTransitionReviewModalOpen(true);
      setIsLoadingTransitionReview(true);
      setTransitionReviewError("");
      setTransitionReviewPopup(null);
      setTransitionReviewAnswers({});
      setTransitionReviewResult(null);

      try {
        const response = await fetch(
          `/api/course/transition-review/popup?journey_path_id=${encodeURIComponent(
            journey.journey_path_id,
          )}&from_course_id=${encodeURIComponent(
            pair.fromNode.course_id,
          )}&to_course_id=${encodeURIComponent(pair.toNode.course_id)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as TransitionReviewPopupApiResponse;
        if (!response.ok || !payload.success || !payload.popup) {
          throw new Error(payload.message ?? "Unable to load transition review.");
        }

        if (!payload.popup.should_show || !payload.popup.review_id) {
          await openCourseFromTransitionReview(pair.toNode.course_id);
          return;
        }

        setTransitionReviewPopup({
          review_id: payload.popup.review_id,
          from_course_id: payload.popup.from_course_id ?? pair.fromNode.course_id,
          to_course_id: payload.popup.to_course_id ?? pair.toNode.course_id,
          instructions: payload.popup.instructions,
          questions: payload.popup.questions ?? [],
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to load transition review.";
        setTransitionReviewError(message);
      } finally {
        setIsLoadingTransitionReview(false);
      }
    },
    [journey, loadCourseDetails, openCourseFromTransitionReview, resolveTransitionReviewPair],
  );

  const handleTransitionReviewGoBack = useCallback(async () => {
    if (!transitionReviewPopup) {
      resetTransitionReviewState();
      return;
    }

    setIsSubmittingTransitionReview(true);
    setTransitionReviewError("");
    try {
      await fetch("/api/course/transition-review/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          review_id: transitionReviewPopup.review_id,
          selected_action: "go_back",
        }),
      });
    } catch {
      // Ignore go-back tracking failures; user should still be able to return.
    } finally {
      setIsSubmittingTransitionReview(false);
    }

    const fromCourseId = transitionReviewPopup.from_course_id;
    await openCourseFromTransitionReview(fromCourseId);
  }, [openCourseFromTransitionReview, resetTransitionReviewState, transitionReviewPopup]);

  const handleTransitionReviewSubmitAndContinue = useCallback(async () => {
    if (!transitionReviewPopup) {
      return;
    }

    setIsSubmittingTransitionReview(true);
    setTransitionReviewError("");

    try {
      const response = await fetch("/api/course/transition-review/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          review_id: transitionReviewPopup.review_id,
          selected_action: "continue",
          answers: transitionReviewPopup.questions.map((question) => ({
            question_index: question.question_index,
            user_answer: transitionReviewAnswers[question.question_index] ?? "",
          })),
        }),
      });
      const payload = (await response.json()) as TransitionReviewSubmitApiResponse;
      if (!response.ok || !payload.success || !payload.result) {
        throw new Error(payload.message ?? "Unable to submit transition review.");
      }

      const result = payload.result;
      setTransitionReviewResult({
        score: result.score,
        total_questions: result.total_questions,
        correct_count: result.correct_count,
        performance: result.performance,
        evaluations: result.evaluations ?? [],
      });

      if (result.performance === "good") {
        setActionMessage("Nice review check-in. Moving to the next lesson.");
        await openCourseFromTransitionReview(transitionReviewPopup.to_course_id);
        return;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to submit transition review.";
      setTransitionReviewError(message);
    } finally {
      setIsSubmittingTransitionReview(false);
    }
  }, [
    openCourseFromTransitionReview,
    transitionReviewAnswers,
    transitionReviewPopup,
  ]);

  function closeModal() {
    if (isStartingCourse || isPreparingTest || isSubmittingTest || isSubmittingResourceAction) {
      return;
    }
    setIsWeaknessDrillModalOpen(false);
    setIsLoadingWeaknessDrill(false);
    setWeaknessDrillError("");
    setActiveWeaknessConcept("");
    setWeaknessDrillData(null);
    setIsGeneratingWeaknessTest(false);
    setShowWeaknessPractice(false);
    setWeaknessPracticeResponses({});
    setWeaknessPracticeResult(null);
    setShowWeaknessResultPopup(false);
    setWeaknessResultPopupPayload(null);
    setPendingWeaknessResultSound(null);
    setIsResolvingWeakness(false);
    setWeaknessConcepts([]);
    setIsLoadingWeakness(false);
    setWeaknessError("");
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
    setRequiredTestScore(AI_TEST_PASSING_SCORE);
    setTestFeedback("");
    setTestResult(null);
    setAiTestMode("taking");
    setAttemptHistory([]);
    setShowResultPopup(false);
    setResultPopupPayload(null);
    setPendingAiTestResultSound(null);
    setHasAnyPreviousTestAttempts(false);
    resetTransitionReviewState();
  }

  function closeAiTestModal() {
    if (isPreparingTest || isSubmittingTest) {
      return;
    }
    setAiTestError("");
    setShowResultPopup(false);
    setResultPopupPayload(null);
    setPendingAiTestResultSound(null);
    setIsAiTestModalOpen(false);
  }

  function closeWeaknessDrillModal() {
    if (isLoadingWeaknessDrill || isGeneratingWeaknessTest) {
      return;
    }
    setIsWeaknessDrillModalOpen(false);
    setWeaknessDrillError("");
    setActiveWeaknessConcept("");
    setWeaknessDrillData(null);
    setIsGeneratingWeaknessTest(false);
    setShowWeaknessPractice(false);
    setWeaknessPracticeResponses({});
    setWeaknessPracticeResult(null);
    setShowWeaknessResultPopup(false);
    setWeaknessResultPopupPayload(null);
    setPendingWeaknessResultSound(null);
    setIsResolvingWeakness(false);
  }

  function dismissWeaknessResultPopup() {
    setShowWeaknessResultPopup(false);
    setWeaknessResultPopupPayload(null);
    setPendingWeaknessResultSound(null);
  }

  function dismissResultPopup() {
    setShowResultPopup(false);
    setResultPopupPayload(null);
    setPendingAiTestResultSound(null);
  }

  async function handleNodeClick(node: JourneyNode) {
    setJourneyError("");
    const nodeState = resolveJourneyNodeState(node);

    if (!nodeState.canOpen || !node.course_id.trim()) {
      setJourneyError("Please complete previous courses");
      playSound("error");
      return;
    }

    if (shouldInterceptTransitionReview(node)) {
      await openTransitionReviewForNode(node);
      return;
    }
    await loadCourseDetails(node.course_id);
  }

  async function handleWeaknessConceptClick(conceptTag: string) {
    if (!courseDetails) {
      return;
    }
    const normalizedConcept = conceptTag.trim();
    if (!normalizedConcept) {
      return;
    }

    setIsWeaknessDrillModalOpen(true);
    setIsLoadingWeaknessDrill(true);
    setWeaknessDrillError("");
    setActiveWeaknessConcept(normalizedConcept);
    setWeaknessDrillData(null);
    setIsGeneratingWeaknessTest(false);
    setShowWeaknessPractice(false);
    setWeaknessPracticeResponses({});
    setWeaknessPracticeResult(null);
    setShowWeaknessResultPopup(false);
    setWeaknessResultPopupPayload(null);
    setPendingWeaknessResultSound(null);
    setIsResolvingWeakness(false);

    try {
      const response = await fetch(
        `/api/course/weakness/${encodeURIComponent(courseDetails.id)}/drill`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            concept_tag: normalizedConcept,
            action: "open",
          }),
        },
      );
      const payload = (await response.json()) as WeaknessConceptDrillApiResponse;
      if (!response.ok || !payload.success || !payload.drill) {
        throw new Error(payload.message ?? "Unable to load weakness concept drill.");
      }
      setWeaknessDrillData(payload.drill);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load weakness concept drill.";
      setWeaknessDrillError(message);
    } finally {
      setIsLoadingWeaknessDrill(false);
    }
  }

  async function handleImproveWeakness() {
    if (!courseDetails || !activeWeaknessConcept || isGeneratingWeaknessTest) {
      return;
    }

    setIsGeneratingWeaknessTest(true);
    setWeaknessDrillError("");
    setWeaknessPracticeResponses({});
    setWeaknessPracticeResult(null);
    setShowWeaknessResultPopup(false);
    setWeaknessResultPopupPayload(null);
    setPendingWeaknessResultSound(null);
    setShowWeaknessPractice(false);

    try {
      const response = await fetch(
        `/api/course/weakness/${encodeURIComponent(courseDetails.id)}/drill`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            concept_tag: activeWeaknessConcept,
            action: "improve",
          }),
        },
      );
      const payload = (await response.json()) as WeaknessConceptDrillApiResponse;
      if (!response.ok || !payload.success || !payload.drill?.test) {
        throw new Error(payload.message ?? "Unable to generate weakness practice test.");
      }
      setWeaknessDrillData(payload.drill);
      setShowWeaknessPractice(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to generate weakness practice test.";
      setWeaknessDrillError(message);
    } finally {
      setIsGeneratingWeaknessTest(false);
    }
  }

  function updateWeaknessChoiceAnswer(questionId: string, optionIndex: number) {
    setWeaknessPracticeResponses((previous) => ({
      ...previous,
      [questionId]: {
        selectedOptionIndex: optionIndex,
        answerText: "",
      },
    }));
  }

  function updateWeaknessTextAnswer(questionId: string, answerText: string) {
    setWeaknessPracticeResponses((previous) => ({
      ...previous,
      [questionId]: {
        selectedOptionIndex: null,
        answerText,
      },
    }));
  }

  async function handleSubmitWeaknessPractice() {
    if (!weaknessDrillData?.test || !courseDetails || !activeWeaknessConcept) {
      return;
    }
    const test = weaknessDrillData.test;
    setIsResolvingWeakness(true);
    setWeaknessDrillError("");
    setShowWeaknessResultPopup(false);
    setWeaknessResultPopupPayload(null);
    setPendingWeaknessResultSound(null);
    try {
      const answers = test.questions.map((question) => ({
        question_id: question.id,
        selected_option_index:
          question.question_type === "multiple_choice"
            ? (weaknessPracticeResponses[question.id]?.selectedOptionIndex ?? null)
            : null,
        answer_text:
          question.question_type === "fill_blank" || question.question_type === "short_answer"
            ? (weaknessPracticeResponses[question.id]?.answerText ?? "")
            : null,
      }));

      const submitResponse = await fetch(
        `/api/course/weakness/${encodeURIComponent(courseDetails.id)}/drill/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            concept_tag: activeWeaknessConcept,
            weakness_test_session_id: test.weakness_test_session_id,
            answers,
          }),
        },
      );
      const submitPayload = (await submitResponse.json()) as WeaknessDrillSubmitApiResponse;
      if (!submitResponse.ok || !submitPayload.success || !submitPayload.result) {
        throw new Error(submitPayload.message || "Unable to submit weakness practice.");
      }

      const result = submitPayload.result;
      const score = Math.max(0, Math.floor(result.score ?? result.earned_score ?? 0));
      const maxScore = Math.max(
        1,
        Math.floor(result.max_score ?? result.total_score ?? test.metadata.total_score ?? 100),
      );
      setWeaknessPracticeResult({
        earnedScore: score,
        totalScore: maxScore,
        passed: result.passed,
      });

      setWeaknessResultPopupPayload({
        score,
        passed: result.passed,
        feedback: getScoreBandFeedback(score),
        emoji: getScoreBandEmoji(score),
        message: getScoreBandMessage(score),
      });
      setShowWeaknessResultPopup(true);
      setPendingWeaknessResultSound({
        primary: result.passed ? "complete" : "failure",
        playUnlock: false,
        score,
        passed: result.passed,
      });
      console.info("[audio] weakness_test_result_sound:queued", {
        primary: result.passed ? "complete" : "failure",
        play_unlock: false,
        score,
        passed: result.passed,
        trigger: "result_received",
      });

      if (result.passed && result.resolved) {
        const targetKey = normalizeWeaknessConceptKey(activeWeaknessConcept);
        setWeaknessConcepts((previous) =>
          previous.filter((concept) => normalizeWeaknessConceptKey(concept) !== targetKey),
        );
        setActionMessage(`Weakness resolved. Great job. (${score}/${maxScore})`);
      }
    } catch (error) {
      setWeaknessDrillError(
        error instanceof Error ? error.message : "Unable to submit weakness practice right now.",
      );
    } finally {
      setIsResolvingWeakness(false);
    }
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
    setPendingAiTestResultSound(null);

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
      setPendingAiTestResultSound(null);
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
    setPendingAiTestResultSound(null);

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
      const previousStatusByNodeId = new Map(
        (journey?.nodes ?? []).map((node) => [
          getJourneyNodeIdentity(node),
          resolveJourneyNodeState(node).status,
        ] as const),
      );
      const newlyUnlockedIds = reviewResult.journey?.nodes
        ? reviewResult.journey.nodes
        .filter((node) => {
          const previousStatus = previousStatusByNodeId.get(getJourneyNodeIdentity(node));
          if (!previousStatus) {
            return false;
          }
          const nextStatus = resolveJourneyNodeState(node).status;
          return (
            previousStatus === "locked" &&
            (nextStatus === "unlocked" ||
              nextStatus === "in_progress" ||
              nextStatus === "ready_for_test")
          );
        })
        .map((node) => getJourneyNodeIdentity(node))
        : [];
      const newlyPassedIds = reviewResult.journey?.nodes
        ? reviewResult.journey.nodes
        .filter((node) => {
          const previousStatus = previousStatusByNodeId.get(getJourneyNodeIdentity(node));
          return resolveJourneyNodeState(node).status === "passed" && previousStatus !== "passed";
        })
        .map((node) => getJourneyNodeIdentity(node))
        : [];
      triggerNodePop([...newlyPassedIds, ...newlyUnlockedIds]);

      if (reviewResult.journey) {
        setJourney(reviewResult.journey);
        emitProgress(reviewResult.journey, "mutation");
      }

      if (reviewResult.passed) {
        setActionMessage(`Great work. You passed with ${reviewResult.score}/100.`);
        setTestFeedback(reviewResult.feedback_summary);
      } else {
        setActionMessage(
          `You scored ${reviewResult.score}/100. You need ${reviewResult.required_score} to pass this course.`,
        );
        setTestFeedback(
          "Review current resource. Try another resource. Retake test later.",
        );
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
      setPendingAiTestResultSound({
        primary: reviewResult.passed ? "complete" : "failure",
        playUnlock: reviewResult.passed && newlyUnlockedIds.length > 0,
        score: reviewResult.score,
        passed: reviewResult.passed,
      });
      console.info("[audio] ai_test_result_sound:queued", {
        primary: reviewResult.passed ? "complete" : "failure",
        play_unlock: reviewResult.passed && newlyUnlockedIds.length > 0,
        score: reviewResult.score,
        passed: reviewResult.passed,
        trigger: "result_received",
      });
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
    setPendingAiTestResultSound(null);
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
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <div>
          <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
            {folder.name}
          </p>
          <h2 className="mt-4 text-3xl font-extrabold text-[#1F2937]">Learning Journey</h2>
          <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
            Start: {folder.currentLevel} · Destination: {folder.targetLevel}
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              void loadJourney({
                reason: "manual_refresh",
                force: true,
              });
            }}
            className="btn-3d btn-3d-white inline-flex h-10 w-auto shrink-0 items-center justify-center px-5 !text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {journeyError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {journeyError}
        </p>
      ) : null}

      {isLoadingJourney ? (
        <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-5">
          <p className="text-sm font-semibold text-[#1F2937]/70">
            {panelState === "generating_journey"
              ? "Generating your journey..."
              : "Loading your learning journey..."}
          </p>
          <div className="mt-3 space-y-2">
            <div className="skeleton-block h-14 rounded-xl" />
            <div className="skeleton-block h-14 rounded-xl" />
            <div className="skeleton-block h-14 rounded-xl" />
          </div>
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
              {visibleJourneyNodes.map((node, index) => {
                const nextNode = visibleJourneyNodes[index + 1];
                const nodeId = getJourneyNodeIdentity(node);
                const nodeState = resolveJourneyNodeState(node);
                const nextNodeState = nextNode ? resolveJourneyNodeState(nextNode) : null;
                const isLocked = nodeState.isLocked;
                const shouldPop = poppingNodeIds.includes(nodeId);
                const isFlipping = flippingNodeIds.includes(nodeId);
                const scoreBadge = nodeState.showScoreBadge ? nodeState.scoreBadgeValue : null;

                return (
                  <div key={nodeId} className="flex flex-col items-center">
                    <div className="journey-node-coin-wrap">
                      <button
                        type="button"
                        onMouseEnter={() => {
                          if (isLocked) {
                            return;
                          }
                          triggerNodeFlip(nodeId);
                        }}
                        onAnimationEnd={(event) => {
                          if (event.animationName !== "journey-node-coin-flip") {
                            return;
                          }
                          clearNodeFlip(nodeId);
                        }}
                        onClick={() => {
                          void handleNodeClick(node);
                        }}
                        disabled={!nodeState.canOpen}
                        className={`${getNodeClassName(nodeState.status, { pop: shouldPop })} journey-node-coin${
                          isFlipping ? " is-flipping" : ""
                        }`}
                        aria-label={`${node.title} ${nodeState.status}`}
                      >
                        {nodeState.isCompleted ? "✓" : node.step_number}
                        {isLocked ? (
                          <span className="absolute -right-1 -top-1 rounded-full bg-[#6B7280] px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                            🔒
                          </span>
                        ) : null}
                        {scoreBadge ? (
                          <span
                            className={`absolute -right-2 -top-2 rounded-full border-2 border-[#1F2937] px-1.5 py-0.5 text-[10px] font-extrabold text-white ${
                              scoreBadge >= AI_TEST_PASSING_SCORE ? "bg-[#58CC02]" : "bg-[#9CA3AF]"
                            }`}
                          >
                            {scoreBadge}
                          </span>
                        ) : null}
                      </button>
                    </div>
                    <p className="mt-2 max-w-[180px] text-center text-xs font-semibold text-[#1F2937]/70">
                      {node.title}
                    </p>

                    {nextNode ? (
                      <div className="my-2 flex flex-col items-center gap-1.5">
                        <span
                          className={getConnectorClassName(
                            nodeState.status,
                            nextNodeState?.status ?? "locked",
                          )}
                        />
                        <span
                          className={getConnectorClassName(
                            nodeState.status,
                            nextNodeState?.status ?? "locked",
                          )}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {journey.nodes.length > visibleJourneyNodes.length ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setVisibleJourneyNodeCount(
                        (previous) => previous + JOURNEY_NODES_VISIBLE_STEP,
                      );
                    }}
                    className="rounded-full border-2 border-[#1F2937]/15 bg-white px-4 py-2 text-xs font-extrabold text-[#1F2937]"
                  >
                    Load more lessons ({journey.nodes.length - visibleJourneyNodes.length} hidden)
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {isTransitionReviewModalOpen ? (
        <div className="fixed inset-0 z-[79] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-3xl rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-extrabold text-[#1F2937]">
                  Quick Review Checkpoint
                </h3>
                <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
                  {transitionReviewPopup?.instructions ??
                    "Before the next lesson, answer a few lightweight review questions."}
                </p>
              </div>
              <span className="rounded-full bg-[#FFF7CF] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/70">
                Transition Review
              </span>
            </div>

            {transitionReviewError ? (
              <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {transitionReviewError}
              </p>
            ) : null}

            {isLoadingTransitionReview ? (
              <p className="mt-4 rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
                Preparing review questions...
              </p>
            ) : null}

            {!isLoadingTransitionReview && transitionReviewPopup ? (
              <div className="mt-4 space-y-3">
                {transitionReviewPopup.questions.map((question) => (
                  <article
                    key={question.question_index}
                    className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4"
                  >
                    <p className="text-sm font-extrabold text-[#1F2937]">
                      Q{question.question_index}. {question.question_text}
                    </p>

                    {question.question_type === "single_choice" && question.options.length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        {question.options.map((option) => (
                          <label
                            key={`${question.question_index}-${option}`}
                            className="flex items-center gap-2 text-xs font-semibold text-[#1F2937]/80"
                          >
                            <input
                              type="radio"
                              name={`transition-review-${question.question_index}`}
                              checked={
                                (transitionReviewAnswers[question.question_index] ?? "") === option
                              }
                              onChange={() =>
                                setTransitionReviewAnswers((previous) => ({
                                  ...previous,
                                  [question.question_index]: option,
                                }))
                              }
                              disabled={Boolean(transitionReviewResult)}
                              className="h-4 w-4 accent-[#58CC02]"
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        value={transitionReviewAnswers[question.question_index] ?? ""}
                        onChange={(event) =>
                          setTransitionReviewAnswers((previous) => ({
                            ...previous,
                            [question.question_index]: event.target.value,
                          }))
                        }
                        disabled={Boolean(transitionReviewResult)}
                        rows={question.question_type === "short_answer" ? 3 : 2}
                        className="mt-3 w-full resize-y rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        placeholder="Type your answer"
                      />
                    )}
                  </article>
                ))}
              </div>
            ) : null}

            {transitionReviewResult ? (
              <div className="mt-4 rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
                <p className="text-base font-extrabold text-[#1F2937]">
                  Score: {transitionReviewResult.correct_count}/
                  {transitionReviewResult.total_questions}
                  {transitionReviewResult.score !== null
                    ? ` (${transitionReviewResult.score}%)`
                    : ""}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#1F2937]/75">
                  {transitionReviewResult.performance === "good"
                    ? "Great recall. You are ready for the next lesson."
                    : "No worries. Review the correct answers below, then continue when ready."}
                </p>

                {transitionReviewResult.performance === "weak" ? (
                  <div className="mt-3 space-y-2">
                    {transitionReviewResult.evaluations.map((item) => (
                      <article
                        key={`transition-review-eval-${item.question_index}`}
                        className="rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3"
                      >
                        <p className="text-xs font-bold text-[#1F2937]">
                          Q{item.question_index} · {item.is_correct ? "Correct" : "Needs review"}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                          Your answer: {item.user_answer || "(empty)"}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                          Correct answer: {item.correct_answer}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">
                          {item.explanation}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleTransitionReviewGoBack();
                }}
                disabled={isSubmittingTransitionReview || isLoadingTransitionReview}
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-6 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                Go Back
              </button>

              {transitionReviewResult?.performance === "weak" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!transitionReviewPopup) {
                      return;
                    }
                    void openCourseFromTransitionReview(transitionReviewPopup.to_course_id);
                  }}
                  disabled={isSubmittingTransitionReview || isLoadingTransitionReview}
                  className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center px-6 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Continue to Next Lesson
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleTransitionReviewSubmitAndContinue();
                  }}
                  disabled={isSubmittingTransitionReview || isLoadingTransitionReview}
                  className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center px-6 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmittingTransitionReview ? "Checking..." : "Submit and Continue"}
                </button>
              )}
            </div>
          </div>
        </div>
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
                <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
                  <div className="min-w-0">
                    <h3 className="text-2xl font-extrabold text-[#1F2937]">{courseDetails.title}</h3>
                    <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
                      {courseDetails.description ?? "No description available yet."}
                    </p>
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
                  <div className="flex w-full max-w-[340px] justify-self-end flex-col items-end gap-3 lg:w-[320px] lg:max-w-[320px]">
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
                    <div className="w-full flex justify-end mt-6">
                      <div className="flex flex-wrap items-center justify-start gap-2 max-w-[60%]">
                        <span className="text-lg font-bold text-red-500">Weakness:</span>
                        {isLoadingWeakness ? (
                          <span className="text-sm font-semibold text-[#1F2937]/60">Loading...</span>
                        ) : null}
                        {!isLoadingWeakness && formattedWeaknessConcepts.length > 0
                          ? formattedWeaknessConcepts.map((concept) => (
                              <button
                                key={concept.raw}
                                type="button"
                                onClick={() => {
                                  void handleWeaknessConceptClick(concept.raw);
                                }}
                                className="rounded-full border-2 border-red-500/70 bg-red-50 px-3 py-1 text-xs font-bold text-red-600 transition hover:bg-red-100"
                              >
                                {concept.label}
                              </button>
                            ))
                          : null}
                        {!isLoadingWeakness && formattedWeaknessConcepts.length === 0 ? (
                          <span className="text-base font-bold text-red-500">none</span>
                        ) : null}
                      </div>
                      {!isLoadingWeakness && formattedWeaknessConcepts.length === 0 ? (
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/60 text-right">
                          All concepts mastered.
                        </p>
                      ) : null}
                      {weaknessError ? (
                        <p className="mt-1 text-xs font-semibold text-[#c62828] text-right">
                          {weaknessError}
                        </p>
                      ) : null}
                    </div>
                  </div>
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
                  {courseDetails.resources.length === 0 ? (
                    <p className="rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
                      {courseDetails.resource_generation_status === "generating" ||
                      courseDetails.resource_generation_status === "pending"
                        ? "Preparing course resources..."
                        : "No resources available yet. Please try again."}
                    </p>
                  ) : null}
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

      {isWeaknessDrillModalOpen ? (
        <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/40 px-4 motion-modal-overlay">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-7 motion-modal-content">
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
              <div>
                <h3 className="text-2xl font-extrabold text-[#1F2937]">
                  Weakness Drill:{" "}
                  {weaknessDrillData?.concept_label ?? formatConceptLabel(activeWeaknessConcept || "none")}
                </h3>
                <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
                  Focused learning module with targeted resources and concept practice.
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={closeWeaknessDrillModal}
                  disabled={isLoadingWeaknessDrill || isGeneratingWeaknessTest}
                  className="btn-3d btn-3d-white inline-flex h-10 w-auto shrink-0 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Close
                </button>
              </div>
            </div>

            {isLoadingWeaknessDrill ? (
              <p className="mt-4 rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
                Loading weakness concept module...
              </p>
            ) : null}

            {weaknessDrillError ? (
              <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                {weaknessDrillError}
              </p>
            ) : null}

            {weaknessDrillData ? (
              weaknessDrillData.test && showWeaknessPractice ? (
                <div className="relative mt-5 space-y-4">
                  {showWeaknessResultPopup && weaknessResultPopupPayload ? (
                    <div className="absolute right-0 top-0 z-20 w-[min(92vw,360px)]">
                      <div
                        className={`rounded-3xl border-2 border-[#1F2937] px-4 py-4 shadow-[0_8px_0_#1F2937,0_14px_24px_rgba(31,41,55,0.18)] ${
                          weaknessResultPopupPayload.passed ? "bg-[#ECFFE1]" : "bg-[#FFE3E3]"
                        }`}
                        role="status"
                        aria-live="polite"
                      >
                        <button
                          type="button"
                          onClick={dismissWeaknessResultPopup}
                          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#1F2937]/20 bg-white/80 text-base font-extrabold text-[#1F2937] transition hover:bg-white"
                          aria-label="Close weakness result popup"
                        >
                          ×
                        </button>
                        <div className="pr-8">
                          <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/70">
                            Weakness Test Result
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1F2937]/20 bg-white text-2xl">
                              {weaknessResultPopupPayload.emoji}
                            </span>
                            <div>
                              <p className="text-xl font-extrabold text-[#1F2937]">
                                Mark: {weaknessResultPopupPayload.score}
                              </p>
                              <p className="text-sm font-semibold text-[#1F2937]/80">
                                {weaknessResultPopupPayload.feedback}
                              </p>
                            </div>
                          </div>
                          <p className="mt-2 text-xs font-semibold text-[#1F2937]/75">
                            {weaknessResultPopupPayload.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-extrabold text-[#1F2937]">Weakness Practice Test</p>
                      <p className="mt-1 text-xs font-semibold text-[#1F2937]/70">
                        {weaknessDrillData.test.metadata.total_questions} questions · Pass score{" "}
                        {weaknessDrillData.test.required_score || WEAKNESS_TEST_PASSING_SCORE}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowWeaknessPractice(false)}
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm"
                    >
                      Back to Resources
                    </button>
                  </div>

                  <div className="space-y-3">
                    {weaknessDrillData.test.questions.map((question) => (
                      <article
                        key={question.id}
                        className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4"
                      >
                        <p className="text-sm font-extrabold text-[#1F2937]">
                          Q{question.question_order}. {question.question_text}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#1F2937]/65">
                          Type: {question.question_type.replaceAll("_", " ")} · Score: {question.score}
                        </p>
                        {question.question_type === "multiple_choice" ? (
                          <div className="mt-2 space-y-1.5">
                            {question.options.map((option, optionIndex) => (
                              <label
                                key={`${question.id}-${optionIndex}`}
                                className="flex items-center gap-2 text-xs font-semibold text-[#1F2937]/80"
                              >
                                <input
                                  type="radio"
                                  name={`weakness-question-${question.id}`}
                                  checked={
                                    weaknessPracticeResponses[question.id]?.selectedOptionIndex === optionIndex
                                  }
                                  onChange={() => updateWeaknessChoiceAnswer(question.id, optionIndex)}
                                  className="h-4 w-4 accent-[#58CC02]"
                                />
                                <span>{option}</span>
                              </label>
                            ))}
                          </div>
                        ) : null}
                        {question.question_type === "fill_blank" ? (
                          <div className="mt-2">
                            <input
                              type="text"
                              value={weaknessPracticeResponses[question.id]?.answerText ?? ""}
                              onChange={(event) => updateWeaknessTextAnswer(question.id, event.target.value)}
                              className="w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                              placeholder="Type your answer"
                            />
                          </div>
                        ) : null}
                        {question.question_type === "short_answer" ? (
                          <div className="mt-2">
                            <textarea
                              value={weaknessPracticeResponses[question.id]?.answerText ?? ""}
                              onChange={(event) => updateWeaknessTextAnswer(question.id, event.target.value)}
                              rows={4}
                              className="w-full resize-y rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                              placeholder="Write a concise practical answer"
                            />
                          </div>
                        ) : null}
                        {weaknessPracticeResult ? (
                          <p className="mt-2 text-xs font-semibold text-[#1F2937]/70">
                            Explanation: {question.explanation}
                          </p>
                        ) : null}
                      </article>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          void handleSubmitWeaknessPractice();
                        }}
                        disabled={isResolvingWeakness}
                        className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isResolvingWeakness ? "Submitting..." : "Submit Weakness Test"}
                      </button>
                      {weaknessPracticeResult ? (
                        <p className="text-sm font-extrabold text-[#1F2937]">
                          Mark: {weaknessPracticeResult.earnedScore}/{weaknessPracticeResult.totalScore} ·{" "}
                          {weaknessPracticeResult.passed ? "Passed" : "Not passed"}
                        </p>
                      ) : (
                        <p className="text-xs font-semibold text-[#1F2937]/70">
                          Pass score: {weaknessDrillData.test.required_score || WEAKNESS_TEST_PASSING_SCORE}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  <section>
                    <p className="text-base font-extrabold text-[#1F2937]">Concept Explanation</p>
                    <p className="mt-2 text-sm font-semibold text-[#1F2937]/75">
                      {weaknessDrillData.concept_explanation}
                    </p>
                  </section>

                  <section>
                    <p className="text-base font-extrabold text-[#1F2937]">Targeted Resources</p>
                    {weaknessDrillData.resources.length === 0 ? (
                      <p className="mt-2 rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-3 py-2 text-sm font-semibold text-[#1F2937]/70">
                        No targeted resources found right now.
                      </p>
                    ) : (
                      <div className="mt-3 grid gap-3">
                        {weaknessDrillData.resources.map((resource) => (
                          <article
                            key={resource.url}
                            className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4"
                          >
                            <p className="text-sm font-extrabold text-[#1F2937]">{resource.title}</p>
                            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[#1F2937]/60">
                              {resource.provider}
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[#1F2937]/75">
                              {resource.summary}
                            </p>
                            <a
                              href={resource.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex text-xs font-extrabold text-[#1F2937] underline underline-offset-2"
                            >
                              Open resource
                            </a>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    {weaknessDrillData.test ? (
                      <div className="rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-4">
                        <p className="text-sm font-semibold text-[#1F2937]/75">
                          Test is ready. Click below to start the weakness-only practice paper.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowWeaknessPractice(true)}
                          className="btn-3d btn-3d-green mt-3 inline-flex h-10 items-center justify-center px-5 !text-sm"
                        >
                          Start Weakness Test
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-4">
                        <p className="text-sm font-semibold text-[#1F2937]/75">
                          Ready to focus on this weakness. Generate a dedicated test (4 multiple choice, 10 points for each and 4 fill blank, 
                          15 points for each, pass score 90).
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            void handleImproveWeakness();
                          }}
                          disabled={isGeneratingWeaknessTest}
                          className="btn-3d btn-3d-green mt-3 inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isGeneratingWeaknessTest ? "Generating..." : "Improve weakness"}
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              )
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
                  <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
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









