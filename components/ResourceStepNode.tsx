import type { LearningStep } from "@/lib/mockLearningMaps";

export type StepVisualState = "completed" | "current" | "upcoming";

type ResourceStepNodeProps = {
  step: LearningStep;
  isSelected: boolean;
  state: StepVisualState;
  onClick: () => void;
};

export default function ResourceStepNode({
  step,
  isSelected,
  state,
  onClick,
}: ResourceStepNodeProps) {
  const stateClassName =
    state === "completed"
      ? "border-[#1F2937] bg-[#58CC02] text-white shadow-[0_3px_0_#1F2937]"
      : state === "current"
        ? "border-[#1F2937] bg-[#FFD84D] text-[#1F2937] shadow-[0_4px_0_#1F2937]"
        : "border-[#1F2937]/35 bg-white text-[#1F2937]/75";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute z-20 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 text-xs font-extrabold transition-all duration-200 hover:scale-105 ${stateClassName} ${
        isSelected ? "ring-4 ring-[#58CC02]/25" : ""
      }`}
      style={{ left: `${step.x}%`, top: `${step.y}%` }}
      aria-label={`Open resource step ${step.title}`}
      title={step.title}
    >
      {state === "completed" ? "✓" : state === "current" ? "!" : "•"}
    </button>
  );
}
