import FeatureHighlightCard from "@/components/FeatureHighlightCard";
import HelpHeader from "@/components/HelpHeader";
import HelpHero from "@/components/HelpHero";
import JourneyStepCard from "@/components/JourneyStepCard";
import Link from "next/link";

const JOURNEY_STEPS = [
  {
    step: "Step 1",
    title: "Choose your learning field",
    description:
      "Start by choosing what you want to learn, such as Web Development, IELTS, Machine Learning, and more.",
  },
  {
    step: "Step 2",
    title: "Create your path",
    description:
      "Pathly creates a map around your chosen field. Multiple paths appear, and each one can lead to steady progress.",
  },
  {
    step: "Step 3",
    title: "Explore resources",
    description:
      "Each map step is a learning resource: video, article, documentation, or practice material. Click any step to open it.",
  },
  {
    step: "Step 4",
    title: "Pass the AI quick test",
    description:
      "After learning, take the AI quick test. A score of 80 or above passes the course and unlocks your next step.",
  },
  {
    step: "Step 5",
    title: "Rate the route",
    description:
      "When you finish a route, rate it. Other learners in the same field can use ratings to choose their path.",
  },
];

const FEATURE_CARDS = [
  {
    title: "Multiple Paths, One Goal",
    description: "Many valid learning routes can all lead to real progress.",
  },
  {
    title: "Resource Collection",
    description: "Pathly organizes learning materials around a chosen topic.",
  },
  {
    title: "Visible Progress",
    description: "You can track your journey visually with map milestones and explorer movement.",
  },
  {
    title: "Shared Route Ratings",
    description: "Route ratings help the learning community make better decisions.",
  },
];

export default function HowPathlyWorksPage() {
  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <HelpHeader
        actions={[
          { href: "/help/faq", label: "Back to Help", variant: "white" },
          { href: "/dashboard", label: "Dashboard", variant: "green" },
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
            title="How Pathly Works"
            subtitle="From choosing a learning field to reaching your next milestone, here’s how your journey works."
            illustration={
              <svg
                viewBox="0 0 520 340"
                className="h-auto w-full"
                role="img"
                aria-label="Learning map with multiple paths and explorer"
              >
                <rect x="8" y="8" width="504" height="324" rx="30" fill="#F6FCFF" />
                <ellipse cx="126" cy="82" rx="62" ry="22" fill="white" />
                <ellipse cx="372" cy="72" rx="64" ry="24" fill="white" />
                <path d="M44 272 C120 226 190 208 246 214 C312 222 376 204 470 146" stroke="#FFF2A8" strokeWidth="36" strokeLinecap="round" fill="none" />
                <path d="M78 284 C152 240 208 224 260 228 C318 233 380 220 470 178" stroke="#FFF2A8" strokeWidth="32" strokeLinecap="round" fill="none" />
                <path d="M120 296 C196 258 250 246 298 250 C344 254 392 244 468 206" stroke="#FFF2A8" strokeWidth="28" strokeLinecap="round" fill="none" />
                <path d="M48 273 C124 230 190 214 246 219 C312 227 376 209 466 152" stroke="#F3CF22" strokeWidth="4" strokeLinecap="round" strokeDasharray="9 10" fill="none" />
                <path d="M82 285 C154 244 210 229 260 233 C318 238 380 224 465 184" stroke="#F3CF22" strokeWidth="4" strokeLinecap="round" strokeDasharray="9 10" fill="none" />
                <path d="M124 297 C198 261 251 250 298 254 C344 258 392 248 464 211" stroke="#F3CF22" strokeWidth="4" strokeLinecap="round" strokeDasharray="9 10" fill="none" />
                <ellipse cx="425" cy="126" rx="58" ry="33" fill="#FFD84D" />
                <rect x="384" y="111" width="82" height="32" rx="8" fill="#ffce2f" />
                <g fill="#B46D0F">
                  <rect x="396" y="116" width="8" height="27" rx="3" />
                  <rect x="409" y="114" width="8" height="29" rx="3" />
                  <rect x="422" y="114" width="8" height="29" rx="3" />
                  <rect x="435" y="114" width="8" height="29" rx="3" />
                  <rect x="448" y="116" width="8" height="27" rx="3" />
                </g>
                <circle cx="184" cy="266" r="16" fill="#58CC02" />
                <circle cx="184" cy="266" r="7" fill="#FFD84D" />
                <ellipse cx="92" cy="292" rx="16" ry="8" fill="#9adf70" />
                <circle cx="92" cy="266" r="15" fill="#FFD84D" />
                <rect x="83" y="278" width="18" height="28" rx="8" fill="#233f84" />
              </svg>
            }
          />

          <section className="space-y-5">
            <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
              <h2 className="text-2xl font-extrabold text-[#1F2937]">Journey Timeline</h2>
              <p className="mt-1 text-sm font-semibold text-[#1F2937]/68">
                Your learning journey follows a clear map, one milestone at a time.
              </p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {JOURNEY_STEPS.map((item) => (
                  <JourneyStepCard
                    key={item.step}
                    step={item.step}
                    title={item.title}
                    description={item.description}
                  />
                ))}
              </div>
            </article>

            <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
              <h2 className="text-2xl font-extrabold text-[#1F2937]">Feature Highlights</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {FEATURE_CARDS.map((card) => (
                  <FeatureHighlightCard
                    key={card.title}
                    title={card.title}
                    description={card.description}
                  />
                ))}
              </div>
            </article>

            <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
              <h2 className="text-2xl font-extrabold text-[#1F2937]">Why Pathly is different</h2>
              <div className="mt-3 space-y-2 text-sm font-semibold leading-relaxed text-[#1F2937]/70">
                <p>Pathly is not just a list of links.</p>
                <p>Pathly is not just a to-do list.</p>
                <p>Pathly is not just one fixed path.</p>
                <p>
                  Pathly is a visual learning map with multiple paths leading to strong
                  progress.
                </p>
              </div>
            </article>

            <article className="rounded-3xl border-2 border-[#1F2937] bg-white p-6 text-center shadow-[0_8px_0_#1F2937,0_16px_24px_rgba(31,41,55,0.12)]">
              <p className="text-2xl font-extrabold text-[#1F2937]">Ready to build your path?</p>
              <Link
                href="/explore"
                className="btn-3d btn-3d-green mt-4 inline-flex h-11 items-center justify-center px-6 !text-base"
              >
                Start Exploring
              </Link>
            </article>
          </section>
        </div>
      </main>
    </div>
  );
}

