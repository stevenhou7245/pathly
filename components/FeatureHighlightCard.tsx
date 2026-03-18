type FeatureHighlightCardProps = {
  title: string;
  description: string;
};

export default function FeatureHighlightCard({
  title,
  description,
}: FeatureHighlightCardProps) {
  return (
    <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)] transition hover:-translate-y-0.5 hover:border-[#FFD84D]">
      <h3 className="text-xl font-extrabold text-[#1F2937]">{title}</h3>
      <p className="mt-2 text-sm font-semibold leading-relaxed text-[#1F2937]/68">
        {description}
      </p>
    </article>
  );
}
