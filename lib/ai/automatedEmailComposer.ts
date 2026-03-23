import { z } from "zod";
import { sha256Hash, toStableJson } from "@/lib/ai/common";
import { generateStructuredJson } from "@/lib/ai/provider";

export type AutomatedEmailType =
  | "learning_reminder"
  | "comeback_inactivity"
  | "milestone"
  | "review_reminder";

export type AutomatedEmailContext = {
  user_id: string;
  username: string | null;
  email_type: AutomatedEmailType;
  learning_field_title: string;
  current_progress_percent: number;
  next_suggested_step: string;
  preferred_resource_type: string | null;
  inactivity_days: number;
  milestone_label: string | null;
  weak_concept: string | null;
};

const automatedEmailCopySchema = z.object({
  subject: z.string().trim().min(8).max(120),
  greeting: z.string().trim().min(3).max(80),
  encouragement: z.string().trim().min(20).max(320),
  next_step: z.string().trim().min(12).max(220),
  preheader: z.string().trim().min(8).max(180),
  cta_label: z.string().trim().min(2).max(40),
});

function fallbackCopy(context: AutomatedEmailContext) {
  if (context.email_type === "milestone") {
    return {
      subject: `Great progress in ${context.learning_field_title}`,
      greeting: context.username ? `Hi ${context.username},` : "Hi explorer,",
      encouragement: context.milestone_label
        ? `Amazing work. You just reached a milestone: ${context.milestone_label}.`
        : "Amazing work. You just reached a meaningful milestone in your learning path.",
      next_step: `Next step: ${context.next_suggested_step}.`,
      preheader: "You hit a milestone. Keep your momentum going.",
      cta_label: "Continue Learning",
    };
  }

  if (context.email_type === "comeback_inactivity") {
    return {
      subject: `Your ${context.learning_field_title} path is waiting`,
      greeting: context.username ? `Hi ${context.username},` : "Hi explorer,",
      encouragement: `You have been away for ${context.inactivity_days} days. A short comeback session can quickly rebuild momentum.`,
      next_step: `Start with this next step: ${context.next_suggested_step}.`,
      preheader: "A quick comeback session can restart your progress.",
      cta_label: "Come Back Now",
    };
  }

  if (context.email_type === "review_reminder") {
    return {
      subject: `Quick review for ${context.learning_field_title}`,
      greeting: context.username ? `Hi ${context.username},` : "Hi explorer,",
      encouragement:
        context.weak_concept && context.weak_concept.trim()
          ? `A quick review on ${context.weak_concept} can strengthen your understanding.`
          : "A quick targeted review can strengthen your weak points before the next lesson.",
      next_step: `Review this next step: ${context.next_suggested_step}.`,
      preheader: "Short focused review now can save time later.",
      cta_label: "Review Now",
    };
  }

  return {
    subject: `Keep going in ${context.learning_field_title}`,
    greeting: context.username ? `Hi ${context.username},` : "Hi explorer,",
    encouragement:
      context.preferred_resource_type && context.preferred_resource_type.trim()
        ? `You are ${context.current_progress_percent}% through your path. A short ${context.preferred_resource_type} session today can keep your streak alive.`
        : `You are ${context.current_progress_percent}% through your path. A short study session today can keep your streak alive.`,
    next_step: `Next step: ${context.next_suggested_step}.`,
    preheader: "Small consistent sessions drive real long-term progress.",
    cta_label: "Continue Learning",
  };
}

export type AutomatedEmailComposition = {
  subject: string;
  greeting: string;
  encouragement: string;
  next_step: string;
  preheader: string;
  cta_label: string;
  source_hash: string;
  prompt_input_json: Record<string, unknown>;
  provenance: {
    provider: "deepseek" | "deterministic";
    model: string;
    prompt_version: string;
    generated_at: string;
    fallback_used: boolean;
    failure_reason: string | null;
  };
};

export async function composeAutomatedLearningEmail(
  context: AutomatedEmailContext,
): Promise<AutomatedEmailComposition> {
  const promptInput = {
    user_id: context.user_id,
    email_type: context.email_type,
    learning_field_title: context.learning_field_title,
    current_progress_percent: context.current_progress_percent,
    next_suggested_step: context.next_suggested_step,
    preferred_resource_type: context.preferred_resource_type,
    inactivity_days: context.inactivity_days,
    milestone_label: context.milestone_label,
    weak_concept: context.weak_concept,
  };

  const aiResult = await generateStructuredJson({
    feature: "automated_learning_email_copy",
    promptVersion: "automated_learning_email_copy_v1",
    systemInstruction: [
      "You write concise learning engagement emails for Pathly.",
      "Return JSON only with: subject, greeting, encouragement, next_step, preheader, cta_label.",
      "Use only facts from input. Do not invent achievements or activities.",
      "Tone is encouraging and practical, never pushy.",
      "Keep encouragement and next_step brief and clear.",
    ].join(" "),
    input: promptInput,
    outputSchema: automatedEmailCopySchema,
    fallback: () => fallbackCopy(context),
    temperature: 0.4,
    maxOutputTokens: 900,
  });

  const output = aiResult.output;
  const sourceHash = sha256Hash({
    feature: "automated_learning_email_copy",
    prompt_version: aiResult.provenance.prompt_version,
    email_type: context.email_type,
    prompt_input: promptInput,
    output,
  });

  return {
    ...output,
    source_hash: sourceHash,
    prompt_input_json: JSON.parse(toStableJson(promptInput)) as Record<string, unknown>,
    provenance: aiResult.provenance,
  };
}
