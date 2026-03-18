import AuthHeader from "@/components/AuthHeader";
import Link from "next/link";

export default function AuthGatePage() {
  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <AuthHeader backHref="/" backLabel="Back" />

      <main className="relative overflow-hidden pb-12 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-4%] top-24 h-36 w-36 rounded-full bg-[#FFD84D]/25 blur-sm" />
          <div className="absolute right-[-2%] top-40 h-28 w-28 rounded-full bg-[#58CC02]/20 blur-sm" />
          <div className="absolute bottom-0 left-0 h-36 w-64 rounded-tr-[5rem] bg-[#58CC02]/12" />
          <div className="absolute bottom-0 right-0 h-28 w-56 rounded-tl-[4.5rem] bg-[#FFD84D]/18" />
          <div className="absolute left-[12%] top-20 h-8 w-20 rounded-full bg-white/85" />
          <div className="absolute right-[14%] top-16 h-9 w-24 rounded-full bg-white/80" />
        </div>

        <div className="relative mx-auto w-full max-w-5xl px-6 sm:px-8">
          <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
            <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-7 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-9">
              <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
                Start Your Journey
              </p>
              <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-[#1F2937] sm:text-5xl">
                Start your learning journey
              </h1>
              <p className="mt-4 text-lg font-semibold text-[#1F2937]/72">
                Create your explorer account to save your progress, unlock your map, and
                build your own learning path.
              </p>
              <p className="mt-3 text-sm font-semibold text-[#1F2937]/60">
                Every learner can find a path that fits. Pick a destination and begin your first
                quest.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/login"
                  className="btn-3d btn-3d-green inline-flex h-12 items-center justify-center px-7"
                >
                  Log In
                </Link>
                <Link
                  href="/register"
                  className="btn-3d btn-3d-white inline-flex h-12 items-center justify-center px-7 !text-[#1F2937]"
                >
                  Sign Up
                </Link>
              </div>

              <Link
                href="/"
                className="mt-6 inline-block text-sm font-semibold text-[#1F2937]/65 underline decoration-2 underline-offset-4 transition hover:text-[#58CC02]"
              >
                Maybe later
              </Link>
            </section>

            <section className="rounded-[2rem] border-2 border-[#1F2937]/15 bg-white/80 p-5 shadow-[0_6px_0_rgba(31,41,55,0.1)]">
              <svg
                viewBox="0 0 480 360"
                className="h-auto w-full"
                role="img"
                aria-label="Explorer heading toward a learning milestone"
              >
                <rect x="8" y="8" width="464" height="344" rx="30" fill="#F6FCFF" />
                <ellipse cx="115" cy="82" rx="58" ry="22" fill="white" />
                <ellipse cx="326" cy="72" rx="64" ry="24" fill="white" />

                <path
                  d="M42 298 C130 216 206 204 244 225 C292 251 346 250 438 188"
                  stroke="#FFF2A8"
                  strokeWidth="54"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M48 300 C133 222 205 212 244 233 C292 258 347 256 434 194"
                  stroke="#F3CF22"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="10 11"
                  fill="none"
                />

                <ellipse cx="377" cy="148" rx="54" ry="33" fill="#FFD84D" />
                <rect x="339" y="132" width="76" height="32" rx="7" fill="#ffce2f" />
                <g fill="#B46D0F">
                  <rect x="350" y="136" width="9" height="28" rx="4" />
                  <rect x="365" y="134" width="9" height="30" rx="4" />
                  <rect x="380" y="134" width="9" height="30" rx="4" />
                  <rect x="395" y="136" width="9" height="28" rx="4" />
                </g>

                <rect x="284" y="255" width="7" height="18" rx="2.5" fill="#58CC02" />
                <polygon points="291,255 306,260 291,266" fill="#FFD84D" />
                <rect x="332" y="232" width="7" height="17" rx="2.5" fill="#58CC02" />
                <polygon points="339,232 354,237 339,243" fill="#FFD84D" />

                <ellipse cx="130" cy="304" rx="18" ry="10" fill="#9adf70" />
                <circle cx="130" cy="278" r="18" fill="#FFD84D" />
                <rect x="120" y="292" width="20" height="28" rx="8" fill="#233f84" />
                <rect x="112" y="304" width="8" height="14" rx="4" fill="#233f84" />
                <rect x="140" y="304" width="8" height="14" rx="4" fill="#233f84" />
              </svg>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
