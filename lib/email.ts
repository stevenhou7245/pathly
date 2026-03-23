import { sendEmail, type SendEmailResult } from "@/lib/emailSender";
import {
  renderAutomatedLearningEmail,
  renderLearningNudgeEmail,
  renderWelcomeEmail,
} from "@/lib/emailTemplates";

export type SendEmailModeResult =
  | {
      mode: "email";
      providerMessageId: string | null;
    }
  | {
      mode: "development";
    };

function toSendModeResult(result: Extract<SendEmailResult, { ok: true }>): SendEmailModeResult {
  if (result.mode === "development") {
    return { mode: "development" };
  }
  return {
    mode: "email",
    providerMessageId: result.providerMessageId,
  };
}

async function dispatchOrThrow(params: {
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  tags: string[];
}) {
  const result = await sendEmail({
    toEmail: params.toEmail,
    subject: params.subject,
    html: params.html,
    text: params.text,
    tags: params.tags,
  });

  if (!result.ok) {
    throw new Error(result.errorMessage || "Failed to send email.");
  }

  return toSendModeResult(result);
}

export async function sendWelcomeEmail(params: {
  toEmail: string;
  username?: string | null;
}) {
  const content = renderWelcomeEmail({
    username: params.username,
  });
  return dispatchOrThrow({
    toEmail: params.toEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: ["lifecycle", "welcome"],
  });
}

export async function sendLearningNudgeEmail(params: {
  toEmail: string;
  username?: string | null;
  subject: string;
  preheader: string;
  headline: string;
  intro: string;
  actionItems: string[];
  ctaLabel: string;
  ctaUrl: string;
}) {
  const content = renderLearningNudgeEmail({
    subject: params.subject,
    preheader: params.preheader,
    headline: params.headline,
    intro: params.intro,
    actionItems: params.actionItems,
    ctaLabel: params.ctaLabel,
    ctaUrl: params.ctaUrl,
    username: params.username,
  });
  return dispatchOrThrow({
    toEmail: params.toEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: ["automation", "learning-nudge"],
  });
}

export async function sendAutomatedLearningEmail(params: {
  toEmail: string;
  subject: string;
  preheader: string;
  greeting: string;
  encouragement: string;
  nextStep: string;
  ctaLabel: string;
  ctaUrl: string;
  scenarioLabel: string;
  tags?: string[];
}) {
  const content = renderAutomatedLearningEmail({
    subject: params.subject,
    preheader: params.preheader,
    greeting: params.greeting,
    encouragement: params.encouragement,
    nextStep: params.nextStep,
    ctaLabel: params.ctaLabel,
    ctaUrl: params.ctaUrl,
    scenarioLabel: params.scenarioLabel,
  });
  return dispatchOrThrow({
    toEmail: params.toEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: params.tags ?? ["automation", "learning"],
  });
}
