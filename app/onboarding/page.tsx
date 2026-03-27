import Image from "next/image";
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
            <Image
              src="/images/path-selection-illustration.jpg"
              alt="Learning Path Illustration"
              width={1200}
              height={360}
              className="h-auto w-full"
              sizes="(min-width: 1024px) 48rem, 100vw"
              priority
            />
          </div>

          <div className="mx-auto mt-8 max-w-2xl">
            <OnboardingForm />
          </div>
        </div>
      </main>
    </div>
  );
}
