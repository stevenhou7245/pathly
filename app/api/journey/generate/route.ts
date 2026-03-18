import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  generateOrGetJourney,
  isJourneyGenerationError,
  validateJourneySchema,
} from "@/lib/journeyProgression";

export const runtime = "nodejs";

const inFlightJourneyInitialization = new Map<
  string,
  Promise<{
    journey_path_id: string;
    total_steps: number;
    current_step: number;
    learning_field_id: string;
    nodes: Array<{
      step_number: number;
      course_id: string;
      title: string;
      status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
      passed_score: number | null;
    }>;
  }>
>();

const generateJourneySchema = z.object({
  learning_field_id: z.string().uuid("learning_field_id must be a valid UUID."),
  starting_point: z.string().trim().min(1, "starting_point is required."),
  destination: z.string().trim().min(1, "destination is required."),
  desired_total_steps: z.number().int().min(1).max(20).optional(),
});

type GenerateJourneyResponse = {
  success: boolean;
  message?: string;
  error?: {
    code: string;
    step: string;
    details?: Record<string, unknown>;
  };
  journey?: {
    journey_path_id: string;
    total_steps: number;
    current_step: number;
    learning_field_id: string;
    nodes: Array<{
      step_number: number;
      course_id: string;
      title: string;
      status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
      passed_score: number | null;
    }>;
  };
};

function createTraceId() {
  return `journey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  const traceId = createTraceId();
  let currentStep = "init";

  try {
    console.info(`[journey][${traceId}] request:start`);

    currentStep = "authenticate_user";
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: GenerateJourneyResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }
    console.info(`[journey][${traceId}] authenticate_user:ok`, {
      user_id: sessionUser.id,
      username: sessionUser.username,
    });

    let body: unknown;
    currentStep = "read_request_payload";
    try {
      body = await request.json();
    } catch {
      const payload: GenerateJourneyResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }
    console.info(`[journey][${traceId}] read_request_payload:ok`);

    currentStep = "parse_user_selection";
    const parsed = generateJourneySchema.safeParse(body);
    if (!parsed.success) {
      const payload: GenerateJourneyResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }
    console.info(`[journey][${traceId}] parse_user_selection:ok`, {
      learning_field_id: parsed.data.learning_field_id,
      starting_point: parsed.data.starting_point,
      destination: parsed.data.destination,
      desired_total_steps: parsed.data.desired_total_steps ?? null,
    });

    currentStep = "schema_preflight";
    await validateJourneySchema();
    console.info(`[journey][${traceId}] schema_preflight:ok`);

    currentStep = "generate_journey";
    const dedupeKey = [
      sessionUser.id,
      parsed.data.learning_field_id,
      parsed.data.starting_point.trim().toLowerCase(),
      parsed.data.destination.trim().toLowerCase(),
    ].join(":");

    const inFlight = inFlightJourneyInitialization.get(dedupeKey);
    if (inFlight) {
      console.info(`[journey][${traceId}] initialization_in_progress`, {
        user_id: sessionUser.id,
        learning_field_id: parsed.data.learning_field_id,
        dedupe_key: dedupeKey,
      });
    }

    const generationPromise =
      inFlight ??
      generateOrGetJourney({
        userId: sessionUser.id,
        learningFieldId: parsed.data.learning_field_id,
        startingPoint: parsed.data.starting_point,
        destination: parsed.data.destination,
        desiredTotalSteps: parsed.data.desired_total_steps,
      });
    if (!inFlight) {
      inFlightJourneyInitialization.set(dedupeKey, generationPromise);
    }

    let journey;
    try {
      journey = await generationPromise;
    } finally {
      if (!inFlight) {
        inFlightJourneyInitialization.delete(dedupeKey);
      }
    }
    console.info(`[journey][${traceId}] generate_journey:ok`, {
      journey_path_id: journey.journey_path_id,
      total_steps: journey.total_steps,
      current_step: journey.current_step,
      dedupe_key: dedupeKey,
      reused_inflight: Boolean(inFlight),
    });

    const payload: GenerateJourneyResponse = {
      success: true,
      journey,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(`[journey][${traceId}] failed`, {
      step: currentStep,
      error,
      stack: error instanceof Error ? error.stack : null,
    });

    if (isJourneyGenerationError(error)) {
      const payload: GenerateJourneyResponse = {
        success: false,
        message: error.message,
        error: {
          code: error.code,
          step: error.step,
          details: error.details,
        },
      };
      return NextResponse.json(payload, { status: error.status });
    }

    const payload: GenerateJourneyResponse = {
      success: false,
      message: "Unable to generate journey right now.",
      error: {
        code: "UNEXPECTED_GENERATION_FAILURE",
        step: currentStep,
      },
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
