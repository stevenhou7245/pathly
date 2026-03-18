type BrandLogoProps = {
  showText?: boolean;
  className?: string;
  markClassName?: string;
  textClassName?: string;
};

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-full bg-[#58CC02] shadow-sm ${className}`.trim()}
    >
      <svg
        viewBox="0 0 32 32"
        className="h-7 w-7 text-white"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 11.6 C8.3 12.5, 10.8 17.2, 13 22 C15.2 20.2, 17.8 16, 21 14 C23.4 12.6, 25.8 10.5, 28 9.2" />
        <circle cx="5" cy="11.6" r="2.4" fill="currentColor" />
        <circle cx="13" cy="22" r="2.4" fill="currentColor" />
        <circle cx="21" cy="14" r="2.4" fill="currentColor" />
        <circle cx="28" cy="9.2" r="2.4" fill="currentColor" />
      </svg>
    </div>
  );
}

export default function BrandLogo({
  showText = true,
  className = "",
  markClassName,
  textClassName = "text-2xl font-bold tracking-tight text-[#58CC02]",
}: BrandLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <BrandMark className={markClassName} />
      {showText ? <span className={textClassName}>Pathly</span> : null}
    </div>
  );
}
