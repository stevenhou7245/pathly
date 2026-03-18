"use client";

import { useState } from "react";
import { validateEmail } from "@/lib/clientValidation";

type SupportFormValues = {
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
};

type SupportFormErrors = Partial<Record<keyof SupportFormValues, string>>;
type SupportFormTouched = Partial<Record<keyof SupportFormValues, boolean>>;

const EMPTY_VALUES: SupportFormValues = {
  name: "",
  email: "",
  category: "",
  subject: "",
  message: "",
};

export default function SupportForm() {
  const [values, setValues] = useState<SupportFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<SupportFormErrors>({});
  const [touched, setTouched] = useState<SupportFormTouched>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  function validate(nextValues: SupportFormValues) {
    const nextErrors: SupportFormErrors = {};

    if (!nextValues.name.trim()) {
      nextErrors.name = "Please tell us your name.";
    }

    const emailError = validateEmail(nextValues.email, "Please add your email.");
    if (emailError) {
      nextErrors.email = emailError;
    }

    if (!nextValues.category.trim()) {
      nextErrors.category = "Please choose a support category.";
    }

    if (!nextValues.subject.trim()) {
      nextErrors.subject = "Please add a short subject.";
    }

    if (!nextValues.message.trim()) {
      nextErrors.message = "Please describe what happened.";
    } else if (nextValues.message.trim().length < 10) {
      nextErrors.message = "Please add a bit more detail (at least 10 characters).";
    }

    return nextErrors;
  }

  function markTouched(field: keyof SupportFormValues) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof SupportFormValues, value: string) {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    setErrors(validate(nextValues));
    markTouched(field);
    setSuccessMessage("");
  }

  function handleBlur(field: keyof SupportFormValues) {
    markTouched(field);
    setErrors(validate(values));
  }

  function shouldShowError(field: keyof SupportFormValues) {
    if (!errors[field]) {
      return false;
    }
    if (hasSubmitted) {
      return true;
    }
    return Boolean(touched[field] && hasFieldValue(field));
  }

  function shouldShowValid(field: keyof SupportFormValues) {
    return Boolean((hasSubmitted || touched[field]) && !errors[field] && hasFieldValue(field));
  }

  function hasFieldValue(field: keyof SupportFormValues) {
    return values[field].trim().length > 0;
  }

  function getFieldClassName(field: keyof SupportFormValues) {
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    const nextErrors = validate(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    window.setTimeout(() => {
      setSuccessMessage("Your support request has been sent!");
      setValues(EMPTY_VALUES);
      setErrors({});
      setTouched({});
      setHasSubmitted(false);
      setIsSubmitting(false);
    }, 500);
  }

  const errorClassName =
    "mt-2 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]";
  const validClassName =
    "mt-2 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]";
  const shouldDisableSubmit = isSubmitting || Object.keys(validate(values)).length > 0;

  return (
    <article className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
      <h2 className="text-3xl font-extrabold text-[#1F2937]">Send a support request</h2>
      <p className="mt-2 text-sm font-semibold text-[#1F2937]/68">
        Share your issue and we will help you get back on track.
      </p>

      <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="support-name" className="mb-2 block text-sm font-bold text-[#1F2937]">
            Your Name
          </label>
          <input
            id="support-name"
            type="text"
            value={values.name}
            onChange={(event) => handleChange("name", event.target.value)}
            onBlur={() => handleBlur("name")}
            className={getFieldClassName("name")}
            placeholder="Explorer name"
            aria-invalid={shouldShowError("name")}
          />
          {shouldShowError("name") ? <p className={errorClassName}>{errors.name}</p> : null}
          {shouldShowValid("name") ? (
            <p className={validClassName}>Thanks. Name looks good.</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="support-email" className="mb-2 block text-sm font-bold text-[#1F2937]">
            Email Address
          </label>
          <input
            id="support-email"
            type="email"
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            onBlur={() => handleBlur("email")}
            className={getFieldClassName("email")}
            placeholder="you@example.com"
            aria-invalid={shouldShowError("email")}
          />
          {shouldShowError("email") ? <p className={errorClassName}>{errors.email}</p> : null}
          {shouldShowValid("email") ? (
            <p className={validClassName}>Email format looks good.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="support-category"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Category
          </label>
          <select
            id="support-category"
            value={values.category}
            onChange={(event) => handleChange("category", event.target.value)}
            onBlur={() => handleBlur("category")}
            className={getFieldClassName("category")}
            aria-invalid={shouldShowError("category")}
          >
            <option value="">Select category</option>
            <option value="Account">Account</option>
            <option value="Learning Map">Learning Map</option>
            <option value="Progress">Progress</option>
            <option value="Friends & Chat">Friends & Chat</option>
            <option value="Bug Report">Bug Report</option>
            <option value="Other">Other</option>
          </select>
          {shouldShowError("category") ? (
            <p className={errorClassName}>{errors.category}</p>
          ) : null}
          {shouldShowValid("category") ? (
            <p className={validClassName}>Category selected.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="support-subject"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Subject
          </label>
          <input
            id="support-subject"
            type="text"
            value={values.subject}
            onChange={(event) => handleChange("subject", event.target.value)}
            onBlur={() => handleBlur("subject")}
            className={getFieldClassName("subject")}
            placeholder="Short summary of your issue"
            aria-invalid={shouldShowError("subject")}
          />
          {shouldShowError("subject") ? (
            <p className={errorClassName}>{errors.subject}</p>
          ) : null}
          {shouldShowValid("subject") ? (
            <p className={validClassName}>Subject looks clear.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="support-message"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Message
          </label>
          <textarea
            id="support-message"
            value={values.message}
            onChange={(event) => handleChange("message", event.target.value)}
            onBlur={() => handleBlur("message")}
            className={`${getFieldClassName("message")} min-h-32 resize-y`}
            placeholder="Tell us what happened and what you expected."
            aria-invalid={shouldShowError("message")}
          />
          {shouldShowError("message") ? (
            <p className={errorClassName}>{errors.message}</p>
          ) : null}
          {shouldShowValid("message") ? (
            <p className={validClassName}>Thanks. That detail helps a lot.</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={shouldDisableSubmit}
          className="btn-3d btn-3d-green inline-flex h-12 items-center justify-center px-7 text-base disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Sending..." : "Send Request"}
        </button>

        {successMessage ? (
          <p className="rounded-xl bg-[#ecffe1] px-4 py-3 text-sm font-semibold text-[#2f7d14]">
            {successMessage}
          </p>
        ) : null}
      </form>
    </article>
  );
}
