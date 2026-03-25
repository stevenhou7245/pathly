import type { LearningStep } from "@/lib/mockLearningMaps";

type ResourceDetailPanelProps = {
  step: LearningStep | null;
  isCurrentStep: boolean;
  isCompletedStep: boolean;
  onMarkCompleted: () => void;
};

export default function ResourceDetailPanel({
  step,
  isCurrentStep,
  isCompletedStep,
  onMarkCompleted,
}: ResourceDetailPanelProps) {
  if (!step) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-[#1F2937]/20 bg-[#F7FCFF] p-5 text-center">
        <p className="text-lg font-extrabold text-[#1F2937]">Your learning path starts here.</p>
        <p className="mt-2 text-sm font-semibold text-[#1F2937]/65">
          Choose the best step on your path.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_4px_0_rgba(31,41,55,0.08)]">
      <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
        Resource Detail
      </p>
      <h3 className="mt-2 text-xl font-extrabold text-[#1F2937]">{step.title}</h3>
      <p className="mt-2 inline-flex rounded-full border border-[#1F2937]/20 bg-[#FFF9DD] px-3 py-1 text-xs font-bold text-[#1F2937]">
        {step.type}
      </p>
      <p className="mt-3 text-sm font-semibold leading-relaxed text-[#1F2937]/70">
        {step.description}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <a
          href={step.link}
          target="_blank"
          rel="noreferrer"
          className="btn-3d btn-3d-white inline-flex h-11 items-center justify-center !text-base"
        >
          Open Resource
        </a>
        <button
          type="button"
          onClick={onMarkCompleted}
          disabled={!isCurrentStep || isCompletedStep}
          className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center !text-base disabled:cursor-not-allowed disabled:opacity-60"
        >
          Mark as Completed
        </button>
      </div>

      {isCompletedStep ? (
        <p className="mt-3 rounded-lg bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
          Great work. Your path moves forward.
        </p>
      ) : null}

      {!isCurrentStep && !isCompletedStep ? (
        <p className="mt-3 rounded-lg bg-[#FFF5D7] px-3 py-2 text-sm font-semibold text-[#8a6400]">
          Not quite yet. Let&apos;s strengthen this step on your path.
        </p>
      ) : null}
    </div>
  );
}

