"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getPasswordRuleChecks,
  validateCaptchaInput,
  validateConfirmPassword,
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/lib/clientValidation";

type FormValues = {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  captchaInput: string;
  captchaToken: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;
type FormTouched = Partial<Record<keyof FormValues, boolean>>;

const EMPTY_FORM: FormValues = {
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  captchaInput: "",
  captchaToken: "",
};

export default function RegisterForm() {
  const router = useRouter();
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<FormTouched>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [captchaSvgDataUrl, setCaptchaSvgDataUrl] = useState("");
  const [captchaMessage, setCaptchaMessage] = useState("");
  const [isCaptchaMessageError, setIsCaptchaMessageError] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [isSubmitMessageError, setIsSubmitMessageError] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTimeoutRef = useRef<number | null>(null);

  const passwordRuleChecks = useMemo(
    () => getPasswordRuleChecks(formValues.password),
    [formValues.password],
  );

  useEffect(() => {
    void loadCaptcha(false);
    return () => {
      if (redirectTimeoutRef.current !== null) {
        window.clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  async function loadCaptcha(clearInput: boolean) {
    setIsCaptchaLoading(true);
    try {
      const response = await fetch("/api/auth/captcha", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        success: boolean;
        captchaToken?: string;
        captchaSvgDataUrl?: string;
        message?: string;
      };
      if (!response.ok || !payload.success || !payload.captchaToken || !payload.captchaSvgDataUrl) {
        setCaptchaMessage(payload.message || "Unable to load CAPTCHA. Please refresh.");
        setIsCaptchaMessageError(true);
        setCaptchaSvgDataUrl("");
        setFormValues((prev) => ({
          ...prev,
          captchaToken: "",
          captchaInput: clearInput ? "" : prev.captchaInput,
        }));
        return;
      }
      setCaptchaSvgDataUrl(payload.captchaSvgDataUrl);
      setCaptchaMessage("");
      setIsCaptchaMessageError(false);
      setFormValues((prev) => ({
        ...prev,
        captchaToken: payload.captchaToken!,
        captchaInput: clearInput ? "" : prev.captchaInput,
      }));
    } catch {
      setCaptchaMessage("Unable to load CAPTCHA. Please refresh.");
      setIsCaptchaMessageError(true);
      setCaptchaSvgDataUrl("");
      setFormValues((prev) => ({
        ...prev,
        captchaToken: "",
        captchaInput: clearInput ? "" : prev.captchaInput,
      }));
    } finally {
      setIsCaptchaLoading(false);
    }
  }

  function validate(values: FormValues): FormErrors {
    const nextErrors: FormErrors = {};

    const usernameError = validateUsername(values.username);
    if (usernameError) {
      nextErrors.username = usernameError;
    }

    const emailError = validateEmail(values.email);
    if (emailError) {
      nextErrors.email = emailError;
    }

    const passwordError = validatePassword(values.password);
    if (passwordError) {
      nextErrors.password = passwordError;
    }

    const confirmError = validateConfirmPassword(
      values.confirmPassword,
      values.password,
      "Confirm password is required.",
      "These passwords do not match yet.",
    );
    if (confirmError) {
      nextErrors.confirmPassword = confirmError;
    }

    const captchaError = validateCaptchaInput(values.captchaInput);
    if (captchaError) {
      nextErrors.captchaInput = captchaError;
    }

    if (!values.captchaToken.trim()) {
      nextErrors.captchaToken = "CAPTCHA challenge unavailable. Please refresh.";
    }

    return nextErrors;
  }

  function markTouched(field: keyof FormValues) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof FormValues, value: string) {
    const normalizedValue =
      field === "captchaInput"
        ? value.toUpperCase().replace(/\s+/g, "")
        : value;
    const nextValues = { ...formValues, [field]: normalizedValue };
    setFormValues(nextValues);
    setErrors(validate(nextValues));
    markTouched(field);
    setSubmitMessage("");
    setIsSubmitMessageError(false);
  }

  function handleBlur(field: keyof FormValues) {
    markTouched(field);
    setErrors(validate(formValues));
  }

  function shouldShowError(field: keyof FormValues) {
    if (!errors[field]) {
      return false;
    }
    if (hasSubmitted) {
      return true;
    }
    return Boolean(touched[field] && hasFieldValue(field));
  }

  function shouldShowValid(field: keyof FormValues) {
    return Boolean((hasSubmitted || touched[field]) && !errors[field] && hasFieldValue(field));
  }

  function hasFieldValue(field: keyof FormValues) {
    if (field === "password") {
      return formValues.password.length > 0;
    }
    return formValues[field].trim().length > 0;
  }

  function getInputClassName(field: keyof FormValues) {
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);

    const nextErrors = validate(formValues);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: formValues.username.trim(),
          email: formValues.email.trim(),
          password: formValues.password,
          confirmPassword: formValues.confirmPassword,
          captchaInput: formValues.captchaInput.trim(),
          captchaToken: formValues.captchaToken,
        }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        message: string;
        refreshCaptcha?: boolean;
      };

      if (!response.ok || !payload.success) {
        setSubmitMessage(payload.message || "Failed to create account.");
        setIsSubmitMessageError(true);
        if (payload.refreshCaptcha) {
          await loadCaptcha(true);
        }
        return;
      }

      setSubmitMessage("Account created successfully! Redirecting to login...");
      setIsSubmitMessageError(false);
      setCaptchaMessage("");
      setIsCaptchaMessageError(false);
      setFormValues(EMPTY_FORM);
      setErrors({});
      setTouched({});
      setHasSubmitted(false);
      await loadCaptcha(true);

      redirectTimeoutRef.current = window.setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch {
      setSubmitMessage("Failed to create account.");
      setIsSubmitMessageError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  const errorClassName =
    "mt-2 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]";
  const validClassName =
    "mt-2 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]";
  const formIsValid = Object.keys(validate(formValues)).length === 0;
  const shouldDisableSubmit = isSubmitting || isCaptchaLoading || !formIsValid;

  return (
    <div className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
      <h2 className="text-3xl font-extrabold text-[#1F2937]">Join Pathly</h2>
      <p className="mt-2 text-base font-semibold text-[#1F2937]/70">
        Create your account and start building your learning path.
      </p>

      <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
        <div>
          <label
            htmlFor="register-username"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Username
          </label>
          <input
            id="register-username"
            type="text"
            value={formValues.username}
            onChange={(event) => handleChange("username", event.target.value)}
            onBlur={() => handleBlur("username")}
            className={getInputClassName("username")}
            placeholder="Your explorer name"
            autoComplete="username"
            aria-invalid={shouldShowError("username")}
          />
          {shouldShowError("username") ? (
            <p className={errorClassName}>{errors.username}</p>
          ) : null}
          {shouldShowValid("username") ? (
            <p className={validClassName}>Great name. You are ready to go.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="register-email"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Email
          </label>
          <input
            id="register-email"
            type="email"
            value={formValues.email}
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
            htmlFor="register-password"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Password
          </label>
          <input
            id="register-password"
            type="password"
            value={formValues.password}
            onChange={(event) => handleChange("password", event.target.value)}
            onBlur={() => handleBlur("password")}
            className={getInputClassName("password")}
            placeholder="Create a password"
            autoComplete="new-password"
            aria-invalid={shouldShowError("password")}
          />
          {formValues.password.length > 0 && (
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
          {shouldShowError("password") ? (
            <p className={errorClassName}>{errors.password}</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="register-confirm-password"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Confirm Password
          </label>
          <input
            id="register-confirm-password"
            type="password"
            value={formValues.confirmPassword}
            onChange={(event) => handleChange("confirmPassword", event.target.value)}
            onBlur={() => handleBlur("confirmPassword")}
            className={getInputClassName("confirmPassword")}
            placeholder="Confirm your password"
            autoComplete="new-password"
            aria-invalid={shouldShowError("confirmPassword")}
          />
          {shouldShowError("confirmPassword") ? (
            <p className={errorClassName}>{errors.confirmPassword}</p>
          ) : null}
          {shouldShowValid("confirmPassword") ? (
            <p className={validClassName}>Passwords match. Nice.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="register-captcha"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            CAPTCHA
          </label>
          <div className="rounded-2xl border-2 border-[#1F2937]/15 bg-[#f8fbff] p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="overflow-hidden rounded-xl border-2 border-[#1F2937]/20 bg-white p-2">
                {captchaSvgDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={captchaSvgDataUrl} alt="CAPTCHA challenge" className="h-[74px] w-[220px]" />
                ) : (
                  <div className="flex h-[74px] w-[220px] items-center justify-center text-sm font-semibold text-[#1F2937]/55">
                    {isCaptchaLoading ? "Loading CAPTCHA..." : "CAPTCHA unavailable"}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void loadCaptcha(true)}
                disabled={isCaptchaLoading || isSubmitting}
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-5 !text-[#1F2937] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isCaptchaLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <input
              id="register-captcha"
              type="text"
              value={formValues.captchaInput}
              onChange={(event) => handleChange("captchaInput", event.target.value)}
              onBlur={() => handleBlur("captchaInput")}
              className={`${getInputClassName("captchaInput")} mt-3`}
              placeholder="Type the characters above"
              aria-invalid={shouldShowError("captchaInput")}
              autoComplete="off"
            />
          </div>

          {captchaMessage ? (
            <p
              className={`mt-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                isCaptchaMessageError
                  ? "bg-[#fff1f1] text-[#c62828]"
                  : "bg-[#ecffe1] text-[#2f7d14]"
              }`}
            >
              {captchaMessage}
            </p>
          ) : null}

          {shouldShowError("captchaInput") ? (
            <p className={errorClassName}>{errors.captchaInput}</p>
          ) : null}
          {errors.captchaToken ? <p className={errorClassName}>{errors.captchaToken}</p> : null}
          {shouldShowValid("captchaInput") ? (
            <p className={validClassName}>CAPTCHA format looks correct.</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={shouldDisableSubmit}
          className="btn-3d btn-3d-green mt-2 inline-flex h-12 w-full items-center justify-center text-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Creating Account..." : "Create Account"}
        </button>

        {submitMessage ? (
          <p
            className={`rounded-xl px-4 py-3 text-sm font-semibold ${
              isSubmitMessageError
                ? "bg-[#fff1f1] text-[#c62828]"
                : "bg-[#ecffe1] text-[#2f7d14]"
            }`}
          >
            {submitMessage}
          </p>
        ) : null}
      </form>
    </div>
  );
}
