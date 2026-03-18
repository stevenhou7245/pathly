"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getPasswordRuleChecks,
  validateConfirmPassword,
  validateEmail,
  validatePassword,
  validateVerificationCode,
} from "@/lib/clientValidation";

type ResetValues = {
  email: string;
  verificationCode: string;
  newPassword: string;
  confirmNewPassword: string;
};

type ResetErrors = Partial<Record<keyof ResetValues, string>>;
type ResetTouched = Partial<Record<keyof ResetValues, boolean>>;

const EMPTY_VALUES: ResetValues = {
  email: "",
  verificationCode: "",
  newPassword: "",
  confirmNewPassword: "",
};

export default function ResetPasswordForm() {
  const router = useRouter();
  const [values, setValues] = useState<ResetValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ResetErrors>({});
  const [touched, setTouched] = useState<ResetTouched>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [codeMessage, setCodeMessage] = useState("");
  const [isCodeMessageError, setIsCodeMessageError] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [isSuccessMessageError, setIsSuccessMessageError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const redirectTimeoutRef = useRef<number | null>(null);

  const passwordRuleChecks = useMemo(
    () => getPasswordRuleChecks(values.newPassword),
    [values.newPassword],
  );

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current !== null) {
        window.clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  function validate(nextValues: ResetValues): ResetErrors {
    const nextErrors: ResetErrors = {};

    const emailError = validateEmail(nextValues.email);
    if (emailError) {
      nextErrors.email = emailError;
    }

    const verificationError = validateVerificationCode(nextValues.verificationCode);
    if (verificationError) {
      nextErrors.verificationCode = verificationError;
    }

    const newPasswordError = validatePassword(
      nextValues.newPassword,
      "New password is required.",
    );
    if (newPasswordError) {
      nextErrors.newPassword = newPasswordError;
    }

    const confirmPasswordError = validateConfirmPassword(
      nextValues.confirmNewPassword,
      nextValues.newPassword,
      "Confirm new password is required.",
      "These passwords do not match yet.",
    );
    if (confirmPasswordError) {
      nextErrors.confirmNewPassword = confirmPasswordError;
    }

    return nextErrors;
  }

  function markTouched(field: keyof ResetValues) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof ResetValues, value: string) {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    setErrors(validate(nextValues));
    markTouched(field);
    setSuccessMessage("");
    setIsSuccessMessageError(false);
  }

  function handleBlur(field: keyof ResetValues) {
    markTouched(field);
    setErrors(validate(values));
  }

  function shouldShowError(field: keyof ResetValues) {
    if (!errors[field]) {
      return false;
    }
    if (hasSubmitted) {
      return true;
    }
    return Boolean(touched[field] && hasFieldValue(field));
  }

  function shouldShowValid(field: keyof ResetValues) {
    return Boolean((hasSubmitted || touched[field]) && !errors[field] && hasFieldValue(field));
  }

  function hasFieldValue(field: keyof ResetValues) {
    return field === "newPassword"
      ? values.newPassword.length > 0
      : values[field].trim().length > 0;
  }

  function getInputClassName(field: keyof ResetValues) {
    const baseClassName =
      "w-full rounded-2xl border-2 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:ring-2";
    if (shouldShowError(field)) {
      return `${baseClassName} border-[#df5f5f] bg-[#fff7f7] focus:border-[#df5f5f] focus:ring-[#df5f5f]/20`;
    }
    if (shouldShowValid(field)) {
      return `${baseClassName} border-[#58CC02] bg-[#f8ffef] focus:border-[#58CC02] focus:ring-[#58CC02]/20`;
    }
    return `${baseClassName} border-[#1F2937]/15 focus:border-[#58CC02] focus:ring-[#58CC02]/20`;
  }

  async function handleSendCode() {
    const emailError =
      validateEmail(values.email, "Please enter your email before sending the code.") ||
      (values.email.trim() && validateEmail(values.email)
        ? "Please enter a valid email address before sending the code."
        : undefined);

    markTouched("email");

    if (emailError) {
      setErrors((prev) => ({ ...prev, email: emailError }));
      setCodeMessage("");
      setIsCodeMessageError(true);
      return;
    }

    setIsSendingCode(true);
    setErrors((prev) => ({ ...prev, email: undefined }));

    try {
      const response = await fetch("/api/auth/send-reset-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: values.email.trim() }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        message: string;
        devCode?: string;
      };

      if (!response.ok || !payload.success) {
        setCodeMessage(payload.message || "Failed to send reset code.");
        setIsCodeMessageError(true);
        return;
      }

      const message = payload.devCode
        ? `${payload.message} (dev code: ${payload.devCode})`
        : payload.message;

      setCodeMessage(message);
      setIsCodeMessageError(false);
    } catch {
      setCodeMessage("Failed to send reset code.");
      setIsCodeMessageError(true);
    } finally {
      setIsSendingCode(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);

    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: values.email.trim(),
          verificationCode: values.verificationCode.trim(),
          newPassword: values.newPassword,
          confirmNewPassword: values.confirmNewPassword,
        }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        message: string;
      };

      if (!response.ok || !payload.success) {
        setSuccessMessage(payload.message || "Failed to reset password.");
        setIsSuccessMessageError(true);
        return;
      }

      setSuccessMessage("Password reset successfully! Redirecting to login...");
      setIsSuccessMessageError(false);
      setCodeMessage("");
      setIsCodeMessageError(false);
      setValues(EMPTY_VALUES);
      setTouched({});
      setErrors({});
      setHasSubmitted(false);

      redirectTimeoutRef.current = window.setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch {
      setSuccessMessage("Failed to reset password.");
      setIsSuccessMessageError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  const errorClassName =
    "mt-2 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]";
  const validClassName =
    "mt-2 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]";
  const shouldDisableSubmit =
    isSubmitting || isSendingCode || Object.keys(validate(values)).length > 0;

  return (
    <div className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
      <h2 className="text-3xl font-extrabold text-[#1F2937]">
        Reset Your Password
      </h2>
      <p className="mt-2 text-base font-semibold text-[#1F2937]/70">
        Verify your email and set a new secure password.
      </p>

      <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
        <div>
          <label
            htmlFor="reset-email"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Email
          </label>
          <input
            id="reset-email"
            type="email"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            onBlur={() => handleBlur("email")}
            className={getInputClassName("email")}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={shouldShowError("email")}
          />
          {shouldShowError("email") ? <p className={errorClassName}>{errors.email}</p> : null}
          {shouldShowValid("email") ? (
            <p className={validClassName}>Email format looks good.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="reset-code"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Verification Code
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="reset-code"
              type="text"
              value={values.verificationCode}
              onChange={(event) => handleChange("verificationCode", event.target.value)}
              onBlur={() => handleBlur("verificationCode")}
              className={getInputClassName("verificationCode")}
              placeholder="Enter code"
              aria-invalid={shouldShowError("verificationCode")}
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={isSendingCode || isSubmitting}
              className="btn-3d btn-3d-white inline-flex h-12 shrink-0 items-center justify-center px-6 !text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSendingCode ? "Sending..." : "Send Code"}
            </button>
          </div>
          {codeMessage ? (
            <p
              className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                isCodeMessageError
                  ? "bg-[#fff1f1] text-[#c62828]"
                  : "bg-[#ecffe1] text-[#2f7d14]"
              }`}
            >
              {codeMessage}
            </p>
          ) : null}
          {shouldShowError("verificationCode") ? (
            <p className={errorClassName}>{errors.verificationCode}</p>
          ) : null}
          {shouldShowValid("verificationCode") ? (
            <p className={validClassName}>Code format looks correct.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="reset-new-password"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            New Password
          </label>
          <input
            id="reset-new-password"
            type="password"
            value={values.newPassword}
            onChange={(event) => handleChange("newPassword", event.target.value)}
            onBlur={() => handleBlur("newPassword")}
            className={getInputClassName("newPassword")}
            placeholder="Create a new password"
            autoComplete="new-password"
            aria-invalid={shouldShowError("newPassword")}
          />
          {values.newPassword.length > 0 && (
            <div className="mt-2 rounded-xl bg-[#f8fbff] px-3 py-3">
              <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                Password checklist
              </p>
              <ul className="mt-2 space-y-1">
                {passwordRuleChecks.map((rule) => (
                  <li
                    key={rule.key}
                    className={`text-sm font-semibold ${
                      rule.passed ? "text-[#2f7d14]" : "text-[#b05757]"
                    }`}
                  >
                    {rule.passed ? "✓" : "•"} {rule.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {shouldShowError("newPassword") ? (
            <p className={errorClassName}>{errors.newPassword}</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="reset-confirm-new-password"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Confirm New Password
          </label>
          <input
            id="reset-confirm-new-password"
            type="password"
            value={values.confirmNewPassword}
            onChange={(event) => handleChange("confirmNewPassword", event.target.value)}
            onBlur={() => handleBlur("confirmNewPassword")}
            className={getInputClassName("confirmNewPassword")}
            placeholder="Confirm your new password"
            autoComplete="new-password"
            aria-invalid={shouldShowError("confirmNewPassword")}
          />
          {shouldShowError("confirmNewPassword") ? (
            <p className={errorClassName}>{errors.confirmNewPassword}</p>
          ) : null}
          {shouldShowValid("confirmNewPassword") ? (
            <p className={validClassName}>Passwords match. Nice.</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={shouldDisableSubmit}
          className="btn-3d btn-3d-green mt-2 inline-flex h-12 w-full items-center justify-center text-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Updating..." : "Reset Password"}
        </button>

        {successMessage ? (
          <p
            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
              isSuccessMessageError
                ? "bg-[#fff1f1] text-[#c62828]"
                : "bg-[#ecffe1] text-[#2f7d14]"
            }`}
          >
            {successMessage}
          </p>
        ) : null}
      </form>
    </div>
  );
}
