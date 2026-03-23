import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

const CAPTCHA_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CAPTCHA_DEFAULT_LENGTH = 6;
const CAPTCHA_TTL_MS = 5 * 60 * 1000;

type CaptchaPayload = {
  v: 1;
  id: string;
  exp: number;
  salt: string;
  hash: string;
};

function resolveCaptchaSecret() {
  return (
    process.env.CAPTCHA_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    "pathly-dev-captcha-secret"
  );
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", resolveCaptchaSecret()).update(encodedPayload).digest("base64url");
}

function renderCaptchaSvgText(answer: string) {
  const width = 220;
  const height = 74;
  const charCount = answer.length;
  const charWidth = 30;
  const startX = Math.max(20, Math.floor((width - charCount * charWidth) / 2));

  const lines = Array.from({ length: 9 }, () => {
    const x1 = randomInt(0, width);
    const y1 = randomInt(0, height);
    const x2 = randomInt(0, width);
    const y2 = randomInt(0, height);
    const strokeWidth = randomInt(1, 3);
    const opacity = (0.2 + randomInt(0, 40) / 100).toFixed(2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6B7280" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" />`;
  }).join("");

  const dots = Array.from({ length: 70 }, () => {
    const cx = randomInt(0, width);
    const cy = randomInt(0, height);
    const radius = randomInt(1, 3) / 2;
    const opacity = (0.1 + randomInt(0, 30) / 100).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#1F2937" fill-opacity="${opacity}" />`;
  }).join("");

  const chars = answer
    .split("")
    .map((char, index) => {
      const x = startX + index * charWidth + randomInt(-4, 6);
      const y = 42 + randomInt(-6, 7);
      const rotate = randomInt(-22, 23);
      const color = randomInt(0, 2) === 0 ? "#1F2937" : "#374151";
      return `<text x="${x}" y="${y}" fill="${color}" font-size="30" font-weight="800" font-family="Arial, sans-serif" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="captcha">
      <defs>
        <linearGradient id="captchaBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#F8FBFF" />
          <stop offset="100%" stop-color="#EEF5FF" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="url(#captchaBg)" stroke="#1F2937" stroke-width="2" />
      ${lines}
      ${dots}
      ${chars}
    </svg>
  `.trim();
}

function randomCaptchaText(length = CAPTCHA_DEFAULT_LENGTH) {
  return Array.from({ length }, () => CAPTCHA_CHARSET[randomInt(0, CAPTCHA_CHARSET.length)]).join("");
}

export function normalizeCaptchaInput(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function captchaHash(params: { answer: string; salt: string }) {
  return sha256Hex(`${normalizeCaptchaInput(params.answer)}|${params.salt}|${resolveCaptchaSecret()}`);
}

export function createCaptchaChallenge() {
  const answer = randomCaptchaText();
  const salt = randomUUID();
  const expiresAtMs = Date.now() + CAPTCHA_TTL_MS;
  const payload: CaptchaPayload = {
    v: 1,
    id: randomUUID(),
    exp: expiresAtMs,
    salt,
    hash: captchaHash({ answer, salt }),
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  const token = `${encodedPayload}.${signature}`;
  const svg = renderCaptchaSvgText(answer);
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

  return {
    token,
    svg,
    svgDataUrl,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export type CaptchaVerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid_token" | "expired" | "mismatch" };

export function verifyCaptchaChallenge(params: {
  captchaToken: string;
  captchaInput: string;
}): CaptchaVerifyResult {
  const token = params.captchaToken?.trim() ?? "";
  const input = normalizeCaptchaInput(params.captchaInput ?? "");
  if (!token || !input) {
    return { ok: false, reason: "missing" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "invalid_token" };
  }

  const [encodedPayload, signature] = parts;
  const expectedSignature = signPayload(encodedPayload);
  const providedSignatureBuffer = Buffer.from(signature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    providedSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)
  ) {
    return { ok: false, reason: "invalid_token" };
  }

  let payload: CaptchaPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as CaptchaPayload;
  } catch {
    return { ok: false, reason: "invalid_token" };
  }

  if (!payload || payload.v !== 1 || !payload.salt || !payload.hash || !payload.exp) {
    return { ok: false, reason: "invalid_token" };
  }

  if (payload.exp <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const expectedHash = captchaHash({
    answer: input,
    salt: payload.salt,
  });
  const expectedHashBuffer = Buffer.from(expectedHash, "utf8");
  const payloadHashBuffer = Buffer.from(payload.hash, "utf8");
  if (
    expectedHashBuffer.length !== payloadHashBuffer.length ||
    !timingSafeEqual(expectedHashBuffer, payloadHashBuffer)
  ) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true };
}

