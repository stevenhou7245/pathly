import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

type AuthHeaderProps = {
  backHref: string;
  backLabel?: string;
  secondaryText?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export default function AuthHeader({
  backHref,
  backLabel = "Back",
  secondaryText,
  secondaryHref,
  secondaryLabel,
}: AuthHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/5 bg-white/95 shadow-sm backdrop-blur">
      <nav className="mx-auto flex min-h-20 w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <BrandLogo />
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
          <Link
            href={backHref}
            className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 text-base"
          >
            {backLabel}
          </Link>
          {secondaryText && secondaryHref && secondaryLabel ? (
            <p className="text-sm font-semibold text-[#1F2937]/70">
              {secondaryText}{" "}
              <Link
                href={secondaryHref}
                className="text-[#58CC02] underline decoration-2 underline-offset-4 transition hover:text-[#4db302]"
              >
                {secondaryLabel}
              </Link>
            </p>
          ) : null}
        </div>
      </nav>
    </header>
  );
}

