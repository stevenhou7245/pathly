import AuthHeader from "@/components/AuthHeader";
import OnboardingForm from "@/components/OnboardingForm";

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <AuthHeader backHref="/login" backLabel="Back" />

      <main className="relative overflow-hidden pb-12 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-4%] top-24 h-36 w-36 rounded-full bg-[#FFD84D]/25 blur-sm" />
          <div className="absolute right-[-3%] top-40 h-28 w-28 rounded-full bg-[#58CC02]/20 blur-sm" />
          <div className="absolute bottom-0 left-0 h-36 w-64 rounded-tr-[5rem] bg-[#58CC02]/12" />
          <div className="absolute bottom-0 right-0 h-28 w-56 rounded-tl-[4.5rem] bg-[#FFD84D]/18" />
          <div className="absolute left-[14%] top-20 h-8 w-20 rounded-full bg-white/85" />
          <div className="absolute left-[20%] top-16 h-10 w-10 rounded-full bg-white/85" />
          <div className="absolute right-[12%] top-16 h-9 w-24 rounded-full bg-white/80" />
          <div className="absolute right-[17%] top-10 h-12 w-12 rounded-full bg-white/80" />
        </div>

        <div className="relative mx-auto w-full max-w-4xl px-6 sm:px-8">
          <h1 className="text-center text-4xl font-extrabold tracking-tight text-[#1F2937] sm:text-5xl">
            Choose Your Learning Path
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-center text-lg font-semibold text-[#1F2937]/75">
            Tell us your destination and we will shape your first learning map.
          </p>

          <div className="mx-auto mt-8 max-w-2xl rounded-3xl border-2 border-[#1F2937]/15 bg-white/70 p-5">
            <svg
              viewBox="0 0 460 120"
              className="h-auto w-full"
              role="img"
              aria-label="Learning path and milestone decoration"
            >
              <rect x="6" y="10" width="448" height="100" rx="24" fill="#F5FCFF" />
              <path d="M44 96 C132 44 330 44 416 96" stroke="#FFF2A8" strokeWidth="34" strokeLinecap="round" fill="none" />
              <path d="M54 96 C142 52 322 52 406 96" stroke="#F3CF22" strokeWidth="4" strokeLinecap="round" strokeDasharray="9 11" fill="none" />
              <rect x="94" y="48" width="12" height="28" rx="4" fill="#58CC02" />
              <polygon points="106,48 126,54 106,60" fill="#FFD84D" />
              <rect x="334" y="46" width="12" height="30" rx="4" fill="#58CC02" />
              <polygon points="346,46 366,53 346,60" fill="#FFD84D" />
              <ellipse cx="230" cy="38" rx="42" ry="17" fill="#FFD84D" />
              <g fill="#B46D0F">
                <rect x="206" y="34" width="10" height="12" rx="4" />
                <rect x="220" y="32" width="10" height="14" rx="4" />
                <rect x="234" y="34" width="10" height="12" rx="4" />
              </g>
            </svg>
          </div>

          <div className="mx-auto mt-8 max-w-2xl">
            <OnboardingForm />
          </div>
        </div>
      </main>
    </div>
  );
}
