import { randomInt } from "node:crypto";

export function generateVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
