type JourneyStepCardProps = {
  step: string;
  title: string;
  description: string;
};

export default function JourneyStepCard({ step, title, description }: JourneyStepCardProps) {
  return (
    <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)] transition hover:-translate-y-0.5 hover:border-[#58CC02]/45">
      <p className="inline-flex rounded-full bg-[#FFF7CF] px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
        {step}
      </p>
      <h3 className="mt-3 text-xl font-extrabold text-[#1F2937]">{title}</h3>
      <p className="mt-2 text-sm font-semibold leading-relaxed text-[#1F2937]/68">{description}</p>
    </article>
  );
}
