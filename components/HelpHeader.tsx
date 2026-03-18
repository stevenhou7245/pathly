import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

type HelpHeaderAction = {
  href: string;
  label: string;
  variant?: "green" | "white";
};

type HelpHeaderProps = {
  actions: HelpHeaderAction[];
};

export default function HelpHeader({ actions }: HelpHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/5 bg-white/95 shadow-sm backdrop-blur">
      <nav className="mx-auto flex min-h-20 w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <BrandLogo />
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {actions.map((action, index) => {
            const variant = action.variant ?? (index === actions.length - 1 ? "green" : "white");
            const className =
              variant === "green"
                ? "btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 text-base"
                : "btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 text-base !text-[#1F2937]";

            return (
              <Link key={`${action.href}-${action.label}`} href={action.href} className={className}>
                {action.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
