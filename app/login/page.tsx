import AuthHeader from "@/components/AuthHeader";
import ExplorerIllustration from "@/components/ExplorerIllustration";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <AuthHeader
        backHref="/"
        backLabel="Back"
        secondaryText="Don't have an account?"
        secondaryHref="/register"
        secondaryLabel="Sign up"
      />

      <main className="relative overflow-hidden pb-12 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-3%] top-20 h-36 w-36 rounded-full bg-[#FFD84D]/25 blur-sm" />
          <div className="absolute right-[-4%] top-36 h-28 w-28 rounded-full bg-[#58CC02]/20 blur-sm" />
          <div className="absolute bottom-0 left-0 h-32 w-60 rounded-tr-[5rem] bg-[#58CC02]/10" />
          <div className="absolute bottom-0 right-0 h-28 w-56 rounded-tl-[4.5rem] bg-[#FFD84D]/18" />
          <div className="absolute left-[11%] top-20 h-8 w-20 rounded-full bg-white/85" />
          <div className="absolute left-[16%] top-16 h-10 w-10 rounded-full bg-white/85" />
          <div className="absolute right-[12%] top-16 h-9 w-24 rounded-full bg-white/80" />
          <div className="absolute right-[18%] top-10 h-12 w-12 rounded-full bg-white/80" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-6 sm:px-8">
          <h1 className="text-4xl font-extrabold tracking-tight text-[#1F2937] sm:text-5xl">
            Welcome back to Pathly
          </h1>
          <p className="mt-3 max-w-2xl text-lg font-semibold text-[#1F2937]/75">
            Continue your path and keep moving toward your learning goals.
          </p>

          <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
            <ExplorerIllustration
              imageSrc="/images/login-illustration.png"
              imageAlt="Pathly login illustration"
            />
            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}

