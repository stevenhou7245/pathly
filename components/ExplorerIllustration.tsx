import Image from "next/image";

type ExplorerIllustrationProps = {
  imageSrc?: string;
  imageAlt?: string;
};

export default function ExplorerIllustration({
  imageSrc = "/images/login-illustration.png",
  imageAlt = "Login illustration",
}: ExplorerIllustrationProps) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border-2 border-[#1F2937] bg-[#F7FCFF] p-7 shadow-[0_10px_0_#1F2937,0_20px_30px_rgba(31,41,55,0.12)]">
      <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#FFD84D]/35" />
      <div className="absolute -left-8 bottom-10 h-24 w-24 rounded-full bg-[#58CC02]/25" />

      <div className="relative">
        <p className="inline-flex rounded-full border-2 border-[#1F2937] bg-white px-4 py-1 text-sm font-bold text-[#1F2937]">
          Keep going
        </p>
        <h2 className="mt-4 text-3xl font-extrabold text-[#1F2937]">
          Welcome back, explorer
        </h2>
        <p className="mt-2 text-base font-semibold text-[#1F2937]/70">
          Your learning path is waiting. Pick up where you left off.
        </p>

        <div className="mt-6 overflow-hidden rounded-3xl border-2 border-[#1F2937]/12 bg-[#EAF7FF] p-2">
          <Image
            src={imageSrc}
            alt={imageAlt}
            width={1200}
            height={900}
            className="block h-auto w-full rounded-2xl object-contain"
            sizes="(min-width: 1024px) 38vw, (min-width: 640px) 80vw, 92vw"
            priority
          />
        </div>
      </div>
    </div>
  );
}
