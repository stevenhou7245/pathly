type SendEmailParams = {
  toEmail: string;
  subject: string;
  html: string;
  text: string;
  tags?: string[];
};

export type SendEmailResult =
  | {
      ok: true;
      mode: "email";
      provider: "brevo";
      providerMessageId: string | null;
    }
  | {
      ok: true;
      mode: "development";
      provider: "development";
    }
  | {
      ok: false;
      mode: "email";
      provider: "brevo";
      status: number;
      errorMessage: string;
    };

type DeliveryMode = "auto" | "simulate" | "disabled" | "brevo";

function isTrue(value: string | undefined) {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveDeliveryMode(): DeliveryMode {
  const raw = process.env.EMAIL_DELIVERY_MODE?.trim().toLowerCase();
  if (raw === "auto" || raw === "disabled" || raw === "simulate" || raw === "brevo") {
    return raw;
  }
  return "auto";
}

function logEmailDebug(step: string, detail: Record<string, unknown>) {
  if (!isTrue(process.env.EMAIL_DEBUG_LOGGING)) {
    return;
  }
  console.info(`[email_sender] ${step}`, detail);
}

function maybeSnippet(value: string, max = 240) {
  if (!value) {
    return "";
  }
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const brevoApiKey = process.env.BREVO_API_KEY?.trim();
  const fromEmail = process.env.FROM_EMAIL?.trim();
  const fromName = process.env.FROM_NAME?.trim() || "Pathly";
  const configuredMode = resolveDeliveryMode();
  const isProduction = process.env.NODE_ENV === "production";
  const hasProviderCredentials = Boolean(brevoApiKey && fromEmail);
  const deliveryMode: Exclude<DeliveryMode, "auto"> = isProduction
    ? "brevo"
    : configuredMode === "auto"
      ? hasProviderCredentials
        ? "brevo"
        : "simulate"
      : configuredMode;
  const recipientOverride =
    !isProduction ? process.env.EMAIL_TEST_RECIPIENT_OVERRIDE?.trim() || null : null;
  const finalToEmail = recipientOverride || params.toEmail;

  if (!isProduction) {
    console.info("[email_sender] delivery_mode_decision", {
      configured_mode: configuredMode,
      resolved_mode: deliveryMode,
      has_brevo_api_key: Boolean(brevoApiKey),
      has_from_email: Boolean(fromEmail),
      has_provider_credentials: hasProviderCredentials,
      recipient_override_enabled: Boolean(recipientOverride),
    });
  }

  logEmailDebug("dispatch_attempt", {
    mode: deliveryMode,
    configured_mode: configuredMode,
    to_email: finalToEmail,
    original_to_email: params.toEmail,
    subject: params.subject,
    tags: params.tags ?? [],
    node_env: process.env.NODE_ENV,
  });

  if (isTrue(process.env.EMAIL_DEBUG_LOG_CONTENT)) {
    logEmailDebug("dispatch_content", {
      to_email: finalToEmail,
      subject: params.subject,
      text_preview: maybeSnippet(params.text, 500),
      html_preview: maybeSnippet(params.html.replace(/\s+/g, " ").trim(), 500),
    });
  }

  if (deliveryMode === "disabled") {
    console.info("[email_sender] using_development_fallback", {
      reason: "EMAIL_DELIVERY_MODE=disabled",
      to_email: finalToEmail,
      subject: params.subject,
    });
    logEmailDebug("dispatch_skipped_disabled", {
      to_email: finalToEmail,
      subject: params.subject,
    });
    return {
      ok: true,
      mode: "development",
      provider: "development",
    };
  }

  if (deliveryMode === "simulate") {
    console.info("[email_sender] using_development_fallback", {
      reason:
        configuredMode === "auto"
          ? "missing_provider_credentials_in_auto_mode"
          : "EMAIL_DELIVERY_MODE=simulate",
      to_email: finalToEmail,
      subject: params.subject,
    });
    logEmailDebug("dispatch_simulated", {
      to_email: finalToEmail,
      subject: params.subject,
      original_to_email: params.toEmail,
    });
    return {
      ok: true,
      mode: "development",
      provider: "development",
    };
  }

  if (!fromEmail) {
    if (!isProduction) {
      console.info("[email_sender] using_development_fallback", {
        reason: "missing_from_email",
        to_email: finalToEmail,
        subject: params.subject,
      });
      return {
        ok: true,
        mode: "development",
        provider: "development",
      };
    }
    const message = isProduction
      ? "Email delivery configuration error: FROM_EMAIL is required in production."
      : "Email delivery configuration error: FROM_EMAIL is missing while EMAIL_DELIVERY_MODE=brevo.";
    return {
      ok: false,
      mode: "email",
      provider: "brevo",
      status: 500,
      errorMessage: message,
    };
  }

  if (!brevoApiKey) {
    if (!isProduction) {
      console.info("[email_sender] using_development_fallback", {
        reason: "missing_brevo_api_key",
        to_email: finalToEmail,
        subject: params.subject,
      });
      return {
        ok: true,
        mode: "development",
        provider: "development",
      };
    }
    const message = isProduction
      ? "Email delivery configuration error: BREVO_API_KEY is required in production."
      : "Email delivery configuration error: BREVO_API_KEY is missing while EMAIL_DELIVERY_MODE=brevo.";
    return {
      ok: false,
      mode: "email",
      provider: "brevo",
      status: 500,
      errorMessage: message,
    };
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": brevoApiKey,
    },
    body: JSON.stringify({
      sender: {
        email: fromEmail,
        name: fromName,
      },
      to: [{ email: finalToEmail }],
      subject: params.subject,
      htmlContent: params.html,
      textContent: params.text,
      tags: params.tags ?? [],
    }),
  });

  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const apiMessage =
      (typeof payload.message === "string" && payload.message) ||
      (typeof payload.code === "string" && payload.code) ||
      rawText ||
      "Brevo API request failed.";
    logEmailDebug("dispatch_failed", {
      to_email: finalToEmail,
      subject: params.subject,
      status: response.status,
      error: apiMessage.slice(0, 220),
    });
    return {
      ok: false,
      mode: "email",
      provider: "brevo",
      status: response.status,
      errorMessage: apiMessage.slice(0, 600),
    };
  }

  const providerMessageId =
    typeof payload.messageId === "string" ? payload.messageId : null;

  if (!isProduction) {
    console.info("[email_sender] using_real_email_delivery", {
      provider: "brevo",
      to_email: finalToEmail,
      subject: params.subject,
      provider_message_id: providerMessageId,
    });
  }

  logEmailDebug("dispatch_sent", {
    to_email: finalToEmail,
    subject: params.subject,
    provider_message_id: providerMessageId,
  });

  return {
    ok: true,
    mode: "email",
    provider: "brevo",
    providerMessageId,
  };
}
