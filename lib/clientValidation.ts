const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[A-Za-z0-9]+$/;
const LETTER_REGEX = /[A-Za-z]/;
const NUMBER_REGEX = /[0-9]/;
const SPECIAL_CHAR_REGEX = /[^A-Za-z0-9]/;
const VERIFICATION_CODE_REGEX = /^\d{6}$/;

export type PasswordRuleCheck = {
  key: "length" | "letter" | "number" | "special";
  label: string;
  passed: boolean;
};

export function validateEmail(value: string, requiredMessage = "Email is required.") {
  const email = value.trim();
  if (!email) {
    return requiredMessage;
  }
  if (!EMAIL_REGEX.test(email)) {
    return "Please enter a valid email address.";
  }
  return undefined;
}

export function validateUsername(value: string) {
  const username = value.trim();
  if (!username) {
    return "Username is required.";
  }
  if (!USERNAME_REGEX.test(username)) {
    return "Username can only contain letters and numbers.";
  }
  if (username.length < 3 || username.length > 20) {
    return "Username must be between 3 and 20 characters.";
  }
  return undefined;
}

export function getPasswordRuleChecks(password: string): PasswordRuleCheck[] {
  return [
    {
      key: "length",
      label: "8-16 characters",
      passed: password.length >= 8 && password.length <= 16,
    },
    {
      key: "letter",
      label: "At least one letter",
      passed: LETTER_REGEX.test(password),
    },
    {
      key: "number",
      label: "At least one number",
      passed: NUMBER_REGEX.test(password),
    },
    {
      key: "special",
      label: "At least one special character",
      passed: SPECIAL_CHAR_REGEX.test(password),
    },
  ];
}

export function validatePassword(
  password: string,
  requiredMessage = "Password is required.",
) {
  if (!password) {
    return requiredMessage;
  }
  const checks = getPasswordRuleChecks(password);
  const firstFailed = checks.find((item) => !item.passed);
  if (!firstFailed) {
    return undefined;
  }

  if (firstFailed.key === "length") {
    return "Password must be between 8 and 16 characters.";
  }
  if (firstFailed.key === "letter") {
    return "Password must include at least one letter.";
  }
  if (firstFailed.key === "number") {
    return "Password must include at least one number.";
  }
  return "Password must include at least one special character.";
}

export function validateConfirmPassword(
  confirmPassword: string,
  password: string,
  requiredMessage: string,
  mismatchMessage: string,
) {
  if (!confirmPassword.trim()) {
    return requiredMessage;
  }
  if (confirmPassword !== password) {
    return mismatchMessage;
  }
  return undefined;
}

export function validateVerificationCode(
  value: string,
  requiredMessage = "Verification code is required.",
) {
  const verificationCode = value.trim();
  if (!verificationCode) {
    return requiredMessage;
  }
  if (!VERIFICATION_CODE_REGEX.test(verificationCode)) {
    return "Verification code must be a 6-digit number.";
  }
  return undefined;
}
