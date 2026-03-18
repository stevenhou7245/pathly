"use client";

import type { SessionResponse } from "@/lib/session";
import Image from "next/image";
import { useRouter } from "next/navigation";

type HeroProps = {
  session: SessionResponse;
  isSessionLoading: boolean;
};

const DEFAULT_SESSION: SessionResponse = {
  authenticated: false,
  user: null,
};

export default function Hero({ session = DEFAULT_SESSION, isSessionLoading }: HeroProps) {
  const router = useRouter();

  function handleStartExploring() {
    const nextRoute = session.authenticated ? "/dashboard" : "/auth-gate";
    router.push(nextRoute);
  }

  return (
    <section className="mx-auto flex min-h-[80vh] w-full max-w-6xl items-center px-6 py-10 sm:px-8">
      <div className="grid w-full items-center gap-12 md:grid-cols-2">
        <div className="max-w-xl">
          <p className="mb-4 inline-flex rounded-full border-2 border-[#1F2937] bg-[#FFD84D] px-4 py-1.5 text-sm font-bold text-[#1F2937] shadow-[0_4px_0_#1F2937]">
            Explore your learning journey
          </p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-[#1F2937] sm:text-5xl lg:text-6xl">
            Find your path to mastery.
          </h1>
          <p className="mt-5 text-lg text-[#1F2937]/75 sm:text-xl">
            Learn smarter with an AI-guided path.
          </p>
          {!isSessionLoading && session.authenticated && session.user ? (
            <p className="mt-3 text-sm font-bold text-[#1F2937]/65">
              Welcome back, {session.user.username}. Your path continues here.
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleStartExploring}
            disabled={isSessionLoading}
            className="mt-9 rounded-full border-2 border-[#1F2937] bg-[#58CC02] px-9 py-4 text-lg font-extrabold text-white shadow-[0_6px_0_#1F2937,0_12px_20px_rgba(31,41,55,0.18)] transition hover:-translate-y-0.5 hover:bg-[#74d939] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSessionLoading
              ? "Checking Session..."
              : session.authenticated
              ? "Continue Exploring"
              : "Start Exploring"}
          </button>
        </div>

        <div className="mx-auto w-full max-w-[620px]">
          <div className="overflow-hidden rounded-3xl bg-white shadow-[0_16px_30px_rgba(31,41,55,0.14)]">
            <Image
              src="/images/index-illustration/path-choice.png"
              alt="AI guided learning path illustration"
              width={700}
              height={400}
              priority
              className="block h-auto w-full object-contain"
              sizes="(min-width: 1024px) 42vw, (min-width: 768px) 46vw, 92vw"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
