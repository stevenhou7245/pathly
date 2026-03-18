import { Resend } from "resend";

type SendVerificationEmailResult =
  | {
      mode: "email";
    }
  | {
      mode: "development";
    };

export async function sendVerificationCodeEmail(params: {
  toEmail: string;
  code: string;
}) {
  return sendAuthCodeEmail({
    toEmail: params.toEmail,
    code: params.code,
    subject: "Your Pathly verification code",
    heading: "Pathly Email Verification",
    description: "Your verification code is:",
  });
}

export async function sendResetCodeEmail(params: {
  toEmail: string;
  code: string;
}) {
  return sendAuthCodeEmail({
    toEmail: params.toEmail,
    code: params.code,
    subject: "Your Pathly password reset code",
    heading: "Pathly Password Reset",
    description: "Your password reset code is:",
  });
}

async function sendAuthCodeEmail(params: {
  toEmail: string;
  code: string;
  subject: string;
  heading: string;
  description: string;
}) {
  const { toEmail, code } = params;
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;

  if (!apiKey || !fromEmail) {
    const result: SendVerificationEmailResult = { mode: "development" };
    return result;
  }

  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: fromEmail,
    to: toEmail,
    subject: params.subject,
    text: `${params.description} ${code}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1F2937;">
        <h2 style="margin-bottom: 12px;">${params.heading}</h2>
        <p>${params.description}</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 12px 0;">
          ${code}
        </p>
        <p>This code expires in 10 minutes.</p>
      </div>
    `,
  });

  const result: SendVerificationEmailResult = { mode: "email" };
  return result;
}

