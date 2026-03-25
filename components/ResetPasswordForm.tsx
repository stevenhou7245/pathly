"use client";

import { useEffect, useState } from "react";
import { validateCaptchaInput, validateEmail } from "@/lib/clientValidation";

type ResetValues = {
  email: string;
  captchaInput: string;
  captchaToken: string;
};

type ResetErrors = Partial<Record<keyof ResetValues, string>>;
type ResetTouched = Partial<Record<keyof ResetValues, boolean>>;

const EMPTY_VALUES: ResetValues = {
  email: "",
  captchaInput: "",
  captchaToken: "",
};

export default function ResetPasswordForm() {
  const [values, setValues] = useState<ResetValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ResetErrors>({});
  const [touched, setTouched] = useState<ResetTouched>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [captchaSvgDataUrl, setCaptchaSvgDataUrl] = useState("");
  const [captchaMessage, setCaptchaMessage] = useState("");
  const [isCaptchaMessageError, setIsCaptchaMessageError] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [isSuccessMessageError, setIsSuccessMessageError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(false);

  useEffect(() => {
    void loadCaptcha(false);
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
        setValues((prev) => ({
          ...prev,
          captchaToken: "",
          captchaInput: clearInput ? "" : prev.captchaInput,
        }));
        return;
      }

      setCaptchaSvgDataUrl(payload.captchaSvgDataUrl);
      setCaptchaMessage("");
      setIsCaptchaMessageError(false);
      setValues((prev) => ({
        ...prev,
        captchaToken: payload.captchaToken!,
        captchaInput: clearInput ? "" : prev.captchaInput,
      }));
    } catch {
      setCaptchaMessage("Unable to load CAPTCHA. Please refresh.");
      setIsCaptchaMessageError(true);
      setCaptchaSvgDataUrl("");
      setValues((prev) => ({
        ...prev,
        captchaToken: "",
        captchaInput: clearInput ? "" : prev.captchaInput,
      }));
    } finally {
      setIsCaptchaLoading(false);
    }
  }

  function validate(nextValues: ResetValues): ResetErrors {
    const nextErrors: ResetErrors = {};

    const emailError = validateEmail(nextValues.email);
    if (emailError) {
      nextErrors.email = emailError;
    }

    const captchaError = validateCaptchaInput(nextValues.captchaInput);
    if (captchaError) {
      nextErrors.captchaInput = captchaError;
    }

    if (!nextValues.captchaToken.trim()) {
      nextErrors.captchaToken = "CAPTCHA challenge unavailable. Please refresh.";
    }

    return nextErrors;
  }

  function markTouched(field: keyof ResetValues) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof ResetValues, value: string) {
    const normalizedValue =
      field === "captchaInput"
        ? value.toUpperCase().replace(/\s+/g, "")
        : value;
    const nextValues = { ...values, [field]: normalizedValue };
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
    return values[field].trim().length > 0;
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
          captchaInput: values.captchaInput.trim(),
          captchaToken: values.captchaToken,
        }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        message: string;
        refreshCaptcha?: boolean;
      };

      if (!response.ok || !payload.success) {
        setSuccessMessage(payload.message || "Unable to process reset request.");
        setIsSuccessMessageError(true);
        if (payload.refreshCaptcha) {
          await loadCaptcha(true);
        }
        return;
      }

      setSuccessMessage(payload.message);
      setIsSuccessMessageError(false);
      setValues(EMPTY_VALUES);
      setTouched({});
      setErrors({});
      setHasSubmitted(false);
      await loadCaptcha(true);
    } catch {
      setSuccessMessage("Unable to process reset request.");
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
    isSubmitting || isCaptchaLoading || Object.keys(validate(values)).length > 0;

  return (
    <div className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
      <h2 className="text-3xl font-extrabold text-[#1F2937]">
        Password Reset Help
      </h2>
      <p className="mt-2 text-base font-semibold text-[#1F2937]/70">
        Complete CAPTCHA to submit a secure reset assistance request.
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
            htmlFor="reset-captcha"
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
                className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center px-5 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isCaptchaLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <input
              id="reset-captcha"
              type="text"
              value={values.captchaInput}
              onChange={(event) => handleChange("captchaInput", event.target.value)}
              onBlur={() => handleBlur("captchaInput")}
              className={`${getInputClassName("captchaInput")} mt-3`}
              placeholder="Type the characters above"
              autoComplete="off"
              aria-invalid={shouldShowError("captchaInput")}
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
          {isSubmitting ? "Submitting..." : "Submit Reset Request"}
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

