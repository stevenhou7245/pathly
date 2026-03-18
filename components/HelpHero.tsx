import type { ReactNode } from "react";

type HelpHeroProps = {
  title: string;
  subtitle: string;
  illustration: ReactNode;
};

export default function HelpHero({ title, subtitle, illustration }: HelpHeroProps) {
  return (
    <section className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr]">
      <div className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
        <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
          Pathly Help Center
        </p>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-[#1F2937] sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-lg font-semibold text-[#1F2937]/72">{subtitle}</p>
      </div>

      <div className="rounded-[2rem] border-2 border-[#1F2937]/15 bg-white/80 p-5 shadow-[0_6px_0_rgba(31,41,55,0.1)]">
        {illustration}
      </div>
    </section>
  );
}

