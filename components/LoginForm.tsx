"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { validateEmail } from "@/lib/clientValidation";

type LoginValues = {
  email: string;
  password: string;
};

type LoginErrors = Partial<Record<keyof LoginValues, string>>;
type LoginTouched = Partial<Record<keyof LoginValues, boolean>>;

const EMPTY_LOGIN: LoginValues = {
  email: "",
  password: "",
};

export default function LoginForm() {
  const router = useRouter();
  const [values, setValues] = useState<LoginValues>(EMPTY_LOGIN);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [touched, setTouched] = useState<LoginTouched>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [isSubmitMessageError, setIsSubmitMessageError] = useState(false);
  const redirectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current !== null) {
        window.clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  function validate(nextValues: LoginValues): LoginErrors {
    const nextErrors: LoginErrors = {};

    const emailError = validateEmail(nextValues.email);
    if (emailError) {
      nextErrors.email = emailError;
    }

    if (!nextValues.password) {
      nextErrors.password = "Please enter your password.";
    }

    return nextErrors;
  }

  function markTouched(field: keyof LoginValues) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof LoginValues, value: string) {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    setErrors(validate(nextValues));
    markTouched(field);
    setSubmitMessage("");
    setIsSubmitMessageError(false);
  }

  function handleBlur(field: keyof LoginValues) {
    markTouched(field);
    setErrors(validate(values));
  }

  function shouldShowError(field: keyof LoginValues) {
    if (!errors[field]) {
      return false;
    }
    if (hasSubmitted) {
      return true;
    }
    return Boolean(touched[field] && hasFieldValue(field));
  }

  function shouldShowValid(field: keyof LoginValues) {
    return Boolean((hasSubmitted || touched[field]) && !errors[field] && hasFieldValue(field));
  }

  function hasFieldValue(field: keyof LoginValues) {
    return field === "password" ? values.password.length > 0 : values.email.trim().length > 0;
  }

  function getInputClassName(field: keyof LoginValues) {
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
    setSubmitMessage("");
    setIsSubmitMessageError(false);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: values.email.trim(),
          password: values.password,
        }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        message: string;
        redirectTo?: string;
      };

      if (!response.ok || !payload.success) {
        setSubmitMessage(payload.message || "Invalid email or password.");
        setIsSubmitMessageError(true);
        return;
      }

      setSubmitMessage("Welcome back! Redirecting...");
      setIsSubmitMessageError(false);

      redirectTimeoutRef.current = window.setTimeout(() => {
        router.push(payload.redirectTo ?? "/dashboard");
      }, 500);
    } catch {
      setSubmitMessage("Unable to log in right now.");
      setIsSubmitMessageError(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  const errorClassName =
    "mt-2 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]";
  const validClassName =
    "mt-2 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]";
  const shouldDisableSubmit = isSubmitting || Object.keys(validate(values)).length > 0;

  return (
    <div className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
      <h2 className="text-3xl font-extrabold text-[#1F2937]">
        Welcome back to Pathly
      </h2>
      <p className="mt-2 text-base font-semibold text-[#1F2937]/70">
        Log in and continue your learning journey.
      </p>

      <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
        <div>
          <label
            htmlFor="login-email"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Email
          </label>
          <input
            id="login-email"
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
            htmlFor="login-password"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Password
          </label>
          <input
            id="login-password"
            type="password"
            value={values.password}
            onChange={(event) => handleChange("password", event.target.value)}
            onBlur={() => handleBlur("password")}
            className={getInputClassName("password")}
            placeholder="Your password"
            autoComplete="current-password"
            aria-invalid={shouldShowError("password")}
          />
          {shouldShowError("password") ? (
            <p className={errorClassName}>{errors.password}</p>
          ) : null}
          {shouldShowValid("password") ? (
            <p className={validClassName}>Password entered.</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={shouldDisableSubmit}
          className="btn-3d btn-3d-green mt-2 inline-flex h-12 w-full items-center justify-center text-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Logging in..." : "Log In"}
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

        <div className="text-center">
          <Link
            href="/reset-password"
            className="text-sm font-semibold text-[#1F2937]/70 underline decoration-2 underline-offset-4 transition hover:text-[#58CC02]"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </div>
  );
}

