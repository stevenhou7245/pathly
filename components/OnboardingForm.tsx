"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type OnboardingValues = {
  learningGoal: string;
  currentLevel: string;
  targetLevel: string;
};

type OnboardingErrors = Partial<Record<keyof OnboardingValues, string>>;
type OnboardingTouched = Partial<Record<keyof OnboardingValues, boolean>>;

const EMPTY_VALUES: OnboardingValues = {
  learningGoal: "",
  currentLevel: "",
  targetLevel: "",
};

export default function OnboardingForm() {
  const router = useRouter();
  const [values, setValues] = useState<OnboardingValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<OnboardingErrors>({});
  const [touched, setTouched] = useState<OnboardingTouched>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
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

  function validate(nextValues: OnboardingValues): OnboardingErrors {
    const nextErrors: OnboardingErrors = {};

    if (!nextValues.learningGoal.trim()) {
      nextErrors.learningGoal = "Please tell us what you want to learn.";
    }
    if (!nextValues.currentLevel) {
      nextErrors.currentLevel = "Please choose your current level.";
    }
    if (!nextValues.targetLevel) {
      nextErrors.targetLevel = "Please choose your target level.";
    }

    return nextErrors;
  }

  function markTouched(field: keyof OnboardingValues) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange(field: keyof OnboardingValues, value: string) {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    setErrors(validate(nextValues));
    markTouched(field);
    setSubmitMessage("");
    setIsSubmitMessageError(false);
  }

  function handleBlur(field: keyof OnboardingValues) {
    markTouched(field);
    setErrors(validate(values));
  }

  function shouldShowError(field: keyof OnboardingValues) {
    if (!errors[field]) {
      return false;
    }
    if (hasSubmitted) {
      return true;
    }
    return Boolean(touched[field] && hasFieldValue(field));
  }

  function shouldShowValid(field: keyof OnboardingValues) {
    return Boolean((hasSubmitted || touched[field]) && !errors[field] && hasFieldValue(field));
  }

  function hasFieldValue(field: keyof OnboardingValues) {
    return field === "learningGoal"
      ? values.learningGoal.trim().length > 0
      : values[field].trim().length > 0;
  }

  function getFieldClassName(field: keyof OnboardingValues) {
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

    setIsCreating(true);
    setSubmitMessage("");
    setIsSubmitMessageError(false);

    try {
      const response = await fetch("/api/user/learning-fields", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: values.learningGoal.trim(),
          current_level: values.currentLevel,
          target_level: values.targetLevel,
        }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        message?: string;
      };

      if (!response.ok || !payload.success) {
        setSubmitMessage(payload.message ?? "Unable to save your learning path right now.");
        setIsSubmitMessageError(true);
        setIsCreating(false);
        return;
      }

      setSubmitMessage("Great choice! Building your learning map...");
      setIsSubmitMessageError(false);

      redirectTimeoutRef.current = window.setTimeout(() => {
        router.push("/dashboard");
      }, 700);
    } catch {
      setSubmitMessage("Unable to save your learning path right now.");
      setIsSubmitMessageError(true);
      setIsCreating(false);
    }
  }

  const errorClassName =
    "mt-2 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]";
  const validClassName =
    "mt-2 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]";
  const shouldDisableSubmit = isCreating || Object.keys(validate(values)).length > 0;

  return (
    <div className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
      <h2 className="text-3xl font-extrabold text-[#1F2937]">
        Choose Your Learning Path
      </h2>
      <p className="mt-2 text-base font-semibold text-[#1F2937]/70">
        Set your goal and levels to generate your first learning map.
      </p>

      <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
        <div>
          <label
            htmlFor="onboarding-goal"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            What do you want to learn?
          </label>
          <input
            id="onboarding-goal"
            type="search"
            list="learning-goal-options"
            value={values.learningGoal}
            onChange={(event) => handleChange("learningGoal", event.target.value)}
            onBlur={() => handleBlur("learningGoal")}
            className={getFieldClassName("learningGoal")}
            placeholder="Web Development, Machine Learning, IELTS, Product Design"
            aria-invalid={shouldShowError("learningGoal")}
          />
          <datalist id="learning-goal-options">
            <option value="Web Development" />
            <option value="Machine Learning" />
            <option value="IELTS" />
            <option value="Product Design" />
          </datalist>
          {shouldShowError("learningGoal") ? (
            <p className={errorClassName}>{errors.learningGoal}</p>
          ) : null}
          {shouldShowValid("learningGoal") ? (
            <p className={validClassName}>Great destination. Let us map the road.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="onboarding-current-level"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Current Level
          </label>
          <select
            id="onboarding-current-level"
            value={values.currentLevel}
            onChange={(event) => handleChange("currentLevel", event.target.value)}
            onBlur={() => handleBlur("currentLevel")}
            className={getFieldClassName("currentLevel")}
            aria-invalid={shouldShowError("currentLevel")}
          >
            <option value="">Select your current level</option>
            <option value="Beginner">Beginner</option>
            <option value="Basic">Basic</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Advanced">Advanced</option>
          </select>
          {shouldShowError("currentLevel") ? (
            <p className={errorClassName}>{errors.currentLevel}</p>
          ) : null}
          {shouldShowValid("currentLevel") ? (
            <p className={validClassName}>Current level selected.</p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="onboarding-target-level"
            className="mb-2 block text-sm font-bold text-[#1F2937]"
          >
            Target Level
          </label>
          <select
            id="onboarding-target-level"
            value={values.targetLevel}
            onChange={(event) => handleChange("targetLevel", event.target.value)}
            onBlur={() => handleBlur("targetLevel")}
            className={getFieldClassName("targetLevel")}
            aria-invalid={shouldShowError("targetLevel")}
          >
            <option value="">Select your target level</option>
            <option value="Intermediate">Intermediate</option>
            <option value="Advanced">Advanced</option>
            <option value="Expert">Expert</option>
          </select>
          {shouldShowError("targetLevel") ? (
            <p className={errorClassName}>{errors.targetLevel}</p>
          ) : null}
          {shouldShowValid("targetLevel") ? (
            <p className={validClassName}>Target level selected.</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={shouldDisableSubmit}
          className="btn-3d btn-3d-green mt-2 inline-flex h-12 w-full items-center justify-center text-lg disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isCreating ? "Building Map..." : "Create My Learning Map"}
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
