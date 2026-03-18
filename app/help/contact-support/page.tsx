import HelpHeader from "@/components/HelpHeader";
import HelpHero from "@/components/HelpHero";
import SupportForm from "@/components/SupportForm";
import Link from "next/link";

const QUICK_FIXES = [
  "Check your login credentials",
  "Refresh your dashboard",
  "Reopen the learning field folder",
  "Try switching theme settings if display looks unusual",
  "Retake the AI quick test after more review if your score is below 80",
];

export default function ContactSupportPage() {
  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <HelpHeader
        actions={[
          { href: "/help/faq", label: "Back to Help", variant: "white" },
          { href: "/help/faq", label: "FAQ", variant: "green" },
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
            title="Contact Support"
            subtitle="Need help on your journey? We’re here to guide you back to the road."
            illustration={
              <svg
                viewBox="0 0 520 340"
                className="h-auto w-full"
                role="img"
                aria-label="Support guide with scroll and map"
              >
                <rect x="8" y="8" width="504" height="324" rx="30" fill="#F6FCFF" />
                <ellipse cx="132" cy="82" rx="62" ry="22" fill="white" />
                <ellipse cx="376" cy="72" rx="64" ry="24" fill="white" />
                <path
                  d="M54 278 C150 210 258 184 350 198 C406 206 448 193 488 170"
                  stroke="#FFF2A8"
                  strokeWidth="54"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M58 280 C154 215 256 192 350 206 C406 214 446 201 482 176"
                  stroke="#F3CF22"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="10 11"
                  fill="none"
                />
                <ellipse cx="224" cy="290" rx="20" ry="9" fill="#9adf70" />
                <circle cx="224" cy="258" r="20" fill="#FFD84D" />
                <rect x="212" y="276" width="24" height="34" rx="10" fill="#58CC02" />
                <rect x="204" y="288" width="8" height="14" rx="4" fill="#58CC02" />
                <rect x="236" y="288" width="8" height="14" rx="4" fill="#58CC02" />
                <rect x="248" y="234" width="64" height="46" rx="8" fill="#fff1bd" stroke="#1F2937" strokeWidth="3" />
                <path d="M258 248h44M258 258h34M258 268h40" stroke="#1F2937" strokeWidth="3" strokeLinecap="round" />
                <ellipse cx="395" cy="134" rx="46" ry="28" fill="#FFD84D" />
                <rect x="364" y="121" width="62" height="26" rx="7" fill="#ffce2f" />
                <g fill="#B46D0F">
                  <rect x="373" y="124" width="7" height="22" rx="3" />
                  <rect x="384" y="123" width="7" height="23" rx="3" />
                  <rect x="395" y="123" width="7" height="23" rx="3" />
                  <rect x="406" y="124" width="7" height="22" rx="3" />
                </g>
              </svg>
            }
          />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <SupportForm />

            <div className="space-y-5">
              <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
                <h2 className="text-2xl font-extrabold text-[#1F2937]">
                  Before you send, try these quick fixes
                </h2>
                <div className="mt-4 space-y-3">
                  {QUICK_FIXES.map((tip) => (
                    <div
                      key={tip}
                      className="rounded-2xl border-2 border-[#1F2937]/10 bg-[#F7FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/75 transition hover:border-[#58CC02]/45"
                    >
                      {tip}
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
                <h2 className="text-2xl font-extrabold text-[#1F2937]">Support information</h2>
                <div className="mt-4 space-y-2 text-sm font-semibold text-[#1F2937]/72">
                  <p>
                    Email support:{" "}
                    <a
                      href="mailto:support@pathly.app"
                      className="font-extrabold text-[#58CC02] underline decoration-2 underline-offset-4"
                    >
                      support@pathly.app
                    </a>
                  </p>
                  <p>Response time: within 24-48 hours</p>
                  <p>Best for: account issues, bug reports, missing progress</p>
                </div>
              </article>

              <article className="rounded-3xl border-2 border-[#1F2937] bg-white p-5 text-center shadow-[0_8px_0_#1F2937,0_16px_24px_rgba(31,41,55,0.12)]">
                <p className="text-xl font-extrabold text-[#1F2937]">Need immediate answers?</p>
                <Link
                  href="/help/faq"
                  className="btn-3d btn-3d-green mt-4 inline-flex h-11 items-center justify-center px-6 !text-base"
                >
                  Read FAQ
                </Link>
              </article>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
