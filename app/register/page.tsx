import AuthHeader from "@/components/AuthHeader";
import AuthIllustration from "@/components/AuthIllustration";
import RegisterForm from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <AuthHeader
        backHref="/"
        backLabel="Back"
        secondaryText="Already have an account?"
        secondaryHref="/login"
        secondaryLabel="Log in"
      />

      <main className="relative overflow-hidden pb-12 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-4%] top-24 h-36 w-36 rounded-full bg-[#FFD84D]/25 blur-sm" />
          <div className="absolute right-[-2%] top-40 h-28 w-28 rounded-full bg-[#58CC02]/20 blur-sm" />
          <div className="absolute bottom-0 left-0 h-36 w-64 rounded-tr-[5rem] bg-[#58CC02]/12" />
          <div className="absolute bottom-0 right-0 h-28 w-56 rounded-tl-[4.5rem] bg-[#FFD84D]/18" />
          <div className="absolute left-[12%] top-20 h-8 w-20 rounded-full bg-white/85" />
          <div className="absolute left-[18%] top-16 h-10 w-10 rounded-full bg-white/85" />
          <div className="absolute right-[12%] top-16 h-9 w-24 rounded-full bg-white/80" />
          <div className="absolute right-[18%] top-10 h-12 w-12 rounded-full bg-white/80" />
          <div className="absolute left-[50%] top-[30%] h-2 w-14 -translate-x-1/2 rounded-full bg-[#FFD84D]/45" />
          <div className="absolute left-[50%] top-[32%] h-2 w-10 -translate-x-[30%] rounded-full bg-[#58CC02]/35" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-6 sm:px-8">
          <h1 className="text-4xl font-extrabold tracking-tight text-[#1F2937] sm:text-5xl">
            Join Pathly
          </h1>
          <p className="mt-3 max-w-2xl text-lg font-semibold text-[#1F2937]/75">
            Your learning journey starts with one small step. Set up your
            account and begin your learning path.
          </p>

          <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
            <AuthIllustration />
            <RegisterForm />
          </div>
        </div>
      </main>
    </div>
  );
}

