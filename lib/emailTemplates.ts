type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

function resolveAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEmailLayout(params: {
  title: string;
  preheader: string;
  greeting: string;
  intro: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}) {
  const ctaHtml =
    params.ctaLabel && params.ctaUrl
      ? `
      <div style="margin: 24px 0 8px; text-align: center;">
        <a
          href="${escapeHtml(params.ctaUrl)}"
          style="
            display: inline-block;
            padding: 12px 20px;
            border-radius: 12px;
            border: 2px solid #1F2937;
            background: #58CC02;
            color: #ffffff;
            font-weight: 700;
            font-size: 15px;
            text-decoration: none;
          "
        >
          ${escapeHtml(params.ctaLabel)}
        </a>
      </div>
    `
      : "";

  const footer = params.footerNote
    ? `<p style="margin: 18px 0 0; color: #6B7280; font-size: 13px;">${escapeHtml(params.footerNote)}</p>`
    : "";

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0; padding:0; background:#F4F8FF; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color:#1F2937;">
        <span style="display:none!important; visibility:hidden; opacity:0; height:0; width:0; overflow:hidden;">
          ${escapeHtml(params.preheader)}
        </span>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F8FF; padding:24px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 620px; background:#ffffff; border:2px solid #1F2937; border-radius:20px; overflow:hidden;">
                <tr>
                  <td style="padding: 22px 24px; background: linear-gradient(135deg, #58CC02 0%, #7CE530 100%); border-bottom:2px solid #1F2937;">
                    <p style="margin:0; color:#ffffff; font-size:13px; font-weight:800; letter-spacing:0.5px; text-transform:uppercase;">Pathly</p>
                    <h1 style="margin:8px 0 0; color:#ffffff; font-size:26px; line-height:1.2;">${escapeHtml(params.title)}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px;">
                    <p style="margin:0 0 10px; font-size:15px; font-weight:700; color:#1F2937;">${escapeHtml(params.greeting)}</p>
                    <p style="margin:0 0 14px; font-size:15px; color:#374151; line-height:1.6;">${escapeHtml(params.intro)}</p>
                    ${params.bodyHtml}
                    ${ctaHtml}
                    ${footer}
                    <p style="margin:20px 0 0; color:#6B7280; font-size:12px;">Pathly Learning Platform</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return html;
}

export function renderWelcomeEmail(params: {
  username?: string | null;
}): EmailTemplate {
  const appUrl = resolveAppUrl();
  const subject = "Welcome to Pathly";
  const preheader = "Your learning journey starts now.";
  const greetingName = params.username?.trim() ? `Hi ${params.username?.trim()},` : "Hi explorer,";
  const intro =
    "Welcome to Pathly. Your account is ready, and your personalized learning path is waiting.";
  const bodyHtml = `
    <p style="margin: 0; font-size: 15px; color: #374151; line-height: 1.65;">
      Pick your next topic, build momentum with focused lessons, and keep leveling up step by step.
    </p>
  `;
  const html = renderEmailLayout({
    title: "Welcome Aboard",
    preheader,
    greeting: greetingName,
    intro,
    bodyHtml,
    ctaLabel: "Start Learning",
    ctaUrl: `${appUrl}/dashboard`,
    footerNote: "You can always revisit your dashboard to continue where you left off.",
  });
  const text = [
    "Welcome to Pathly",
    "",
    greetingName,
    "Your account is ready.",
    "Start learning from your dashboard:",
    `${appUrl}/dashboard`,
  ].join("\n");
  return { subject, html, text };
}

export function renderLearningNudgeEmail(params: {
  subject: string;
  preheader: string;
  headline: string;
  intro: string;
  actionItems: string[];
  ctaLabel: string;
  ctaUrl: string;
  username?: string | null;
}): EmailTemplate {
  const greetingName = params.username?.trim() ? `Hi ${params.username.trim()},` : "Hi explorer,";
  const actionItemsHtml =
    params.actionItems.length > 0
      ? `
      <ul style="margin: 12px 0 0; padding-left: 20px; color: #374151; font-size: 14px; line-height: 1.6;">
        ${params.actionItems
          .map((item) => `<li style="margin-bottom: 6px;">${escapeHtml(item)}</li>`)
          .join("")}
      </ul>
    `
      : "";
  const bodyHtml = `
    <p style="margin: 0; font-size: 15px; color: #374151; line-height: 1.65;">
      ${escapeHtml(params.headline)}
    </p>
    <p style="margin: 10px 0 0; font-size: 15px; color: #374151; line-height: 1.65;">
      ${escapeHtml(params.intro)}
    </p>
    ${actionItemsHtml}
  `;
  const html = renderEmailLayout({
    title: "Learning Nudge",
    preheader: params.preheader,
    greeting: greetingName,
    intro: "Here is a personalized AI learning update from Pathly.",
    bodyHtml,
    ctaLabel: params.ctaLabel,
    ctaUrl: params.ctaUrl,
    footerNote: "Small steps every day compound into strong long-term progress.",
  });
  const text = [
    params.subject,
    "",
    greetingName,
    params.headline,
    params.intro,
    ...params.actionItems.map((item, index) => `${index + 1}. ${item}`),
    "",
    params.ctaLabel,
    params.ctaUrl,
  ].join("\n");
  return {
    subject: params.subject,
    html,
    text,
  };
}

export function renderAutomatedLearningEmail(params: {
  subject: string;
  preheader: string;
  greeting: string;
  encouragement: string;
  nextStep: string;
  ctaLabel: string;
  ctaUrl: string;
  scenarioLabel: string;
}): EmailTemplate {
  const bodyHtml = `
    <p style="margin: 0; font-size: 15px; color: #374151; line-height: 1.65;">
      ${escapeHtml(params.encouragement)}
    </p>
    <div style="margin: 14px 0 0; padding: 12px 14px; border-radius: 12px; border: 2px solid #1F2937; background: #F8FCFF;">
      <p style="margin: 0; font-size: 12px; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; color: #1F2937;">
        Next Step
      </p>
      <p style="margin: 6px 0 0; font-size: 14px; color: #1F2937; line-height: 1.6;">
        ${escapeHtml(params.nextStep)}
      </p>
    </div>
  `;

  const html = renderEmailLayout({
    title: params.scenarioLabel,
    preheader: params.preheader,
    greeting: params.greeting,
    intro: "This is your personalized Pathly learning update.",
    bodyHtml,
    ctaLabel: params.ctaLabel,
    ctaUrl: params.ctaUrl,
    footerNote: "Progress compounds through small, consistent actions.",
  });

  const text = [
    params.subject,
    "",
    params.greeting,
    params.encouragement,
    "",
    `Next step: ${params.nextStep}`,
    "",
    params.ctaLabel,
    params.ctaUrl,
  ].join("\n");

  return {
    subject: params.subject,
    html,
    text,
  };
}
