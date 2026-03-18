import FaqHelpContent from "@/components/FaqHelpContent";
import HelpHeader from "@/components/HelpHeader";
import HelpHero from "@/components/HelpHero";

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <HelpHeader
        actions={[
          { href: "/dashboard", label: "Back to Dashboard", variant: "white" },
          { href: "/help/contact-support", label: "Contact Support", variant: "green" },
        ]}
      />

      <main className="relative overflow-hidden pb-12 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-4%] top-24 h-36 w-36 rounded-full bg-[#FFD84D]/25 blur-sm" />
          <div className="absolute right-[-2%] top-40 h-28 w-28 rounded-full bg-[#58CC02]/20 blur-sm" />
          <div className="absolute bottom-0 left-0 h-36 w-64 rounded-tr-[5rem] bg-[#58CC02]/12" />
          <div className="absolute bottom-0 right-0 h-28 w-56 rounded-tl-[4.5rem] bg-[#FFD84D]/18" />
          <div className="absolute left-[12%] top-20 h-8 w-20 rounded-full bg-white/85" />
          <div className="absolute right-[14%] top-16 h-9 w-24 rounded-full bg-white/80" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl space-y-6 px-6 sm:px-8">
          <HelpHero
            title="Frequently Asked Questions"
            subtitle="Find quick answers about your journey, your map, and your learning progress."
            illustration={
              <svg
                viewBox="0 0 520 340"
                className="h-auto w-full"
                role="img"
                aria-label="Explorer on a learning path with FAQ signs"
              >
                <rect x="8" y="8" width="504" height="324" rx="30" fill="#F6FCFF" />
                <ellipse cx="120" cy="82" rx="58" ry="22" fill="white" />
                <ellipse cx="368" cy="72" rx="64" ry="24" fill="white" />
                <path
                  d="M40 270 C156 200 250 190 318 206 C386 220 446 205 490 182"
                  stroke="#FFF2A8"
                  strokeWidth="58"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M48 272 C162 205 252 198 318 214 C386 226 444 212 484 188"
                  stroke="#F3CF22"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="10 11"
                  fill="none"
                />
                <path
                  d="M248 224 C238 184 248 152 274 124"
                  stroke="#1F2937"
                  strokeWidth="5"
                  strokeLinecap="round"
                  fill="none"
                />
                <rect x="268" y="102" width="12" height="36" rx="3" fill="#1F2937" />
                <rect x="280" y="92" width="58" height="20" rx="8" fill="#58CC02" />
                <text x="309" y="106" textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
                  FAQ
                </text>
                <rect x="280" y="116" width="66" height="20" rx="8" fill="#FFD84D" />
                <text x="313" y="130" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1F2937">
                  Support
                </text>
                <rect x="280" y="140" width="52" height="20" rx="8" fill="#9adf70" />
                <text x="306" y="154" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1F2937">
                  Guide
                </text>
                <ellipse cx="170" cy="285" rx="18" ry="9" fill="#9adf70" />
                <circle cx="170" cy="258" r="16" fill="#FFD84D" />
                <rect x="160" y="271" width="20" height="30" rx="8" fill="#233f84" />
                <rect x="152" y="282" width="8" height="14" rx="4" fill="#233f84" />
                <rect x="180" y="282" width="8" height="14" rx="4" fill="#233f84" />
              </svg>
            }
          />

          <FaqHelpContent />
        </div>
      </main>
    </div>
  );
}
