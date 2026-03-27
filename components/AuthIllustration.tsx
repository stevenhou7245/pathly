export default function AuthIllustration() {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border-2 border-[#1F2937] bg-[#FFF9DD] p-7 shadow-[0_10px_0_#1F2937,0_20px_30px_rgba(31,41,55,0.12)]">
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#FFD84D]/40" />
      <div className="absolute -left-6 bottom-8 h-20 w-20 rounded-full bg-[#58CC02]/25" />

      <div className="relative">
        <p className="inline-flex rounded-full border-2 border-[#1F2937] bg-white px-4 py-1 text-sm font-bold text-[#1F2937]">
          Start your adventure
        </p>

        <h2 className="mt-4 text-3xl font-extrabold leading-tight text-[#1F2937]">
          Build your own path through knowledge
        </h2>

        <p className="mt-3 text-base font-semibold text-[#1F2937]/70">
          Friendly quests, tiny milestones, and one big map of your progress.
        </p>

        <div className="mt-7 overflow-hidden rounded-3xl border-2 border-[#1F2937]/12 bg-[#F5FCFF] p-2">
          <svg
            viewBox="0 0 460 260"
            className="block h-auto w-full rounded-2xl"
            role="img"
            aria-label="Learning path illustration"
          >
            <rect x="0" y="0" width="460" height="260" fill="#EAF7FF" />
            <ellipse cx="108" cy="62" rx="56" ry="18" fill="white" />
            <ellipse cx="344" cy="54" rx="62" ry="20" fill="white" />

            <path
              d="M34 92 C122 156 338 156 426 92"
              stroke="#FFF2A8"
              strokeWidth="32"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M40 92 C128 152 332 152 420 92"
              stroke="#F3CF22"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="9 11"
              fill="none"
            />

            <circle cx="82" cy="106" r="18" fill="#58CC02" />
            <circle cx="82" cy="106" r="8" fill="#9FE870" />

            <circle cx="164" cy="134" r="16" fill="#58CC02" />
            <circle cx="164" cy="134" r="7" fill="#9FE870" />

            <circle cx="230" cy="144" r="17" fill="#58CC02" />
            <circle cx="230" cy="144" r="7.5" fill="#9FE870" />

            <circle cx="296" cy="134" r="16" fill="#58CC02" />
            <circle cx="296" cy="134" r="7" fill="#9FE870" />

            <circle cx="378" cy="106" r="18" fill="#58CC02" />
            <circle cx="378" cy="106" r="8" fill="#9FE870" />

            <ellipse cx="230" cy="196" rx="88" ry="14" fill="#58CC02" opacity="0.18" />
          </svg>
        </div>
      </div>
    </div>
  );
}
