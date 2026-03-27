import Image from "next/image";

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
          <Image
            src="/images/register-illustration.png"
            alt="Register illustration"
            width={600}
            height={400}
            className="block h-auto w-full rounded-2xl object-contain"
            priority={false}
          />
        </div>
      </div>
    </div>
  );
}
