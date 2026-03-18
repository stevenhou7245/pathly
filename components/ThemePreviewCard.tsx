type ThemePreviewCardProps = {
  theme: "light" | "dark";
};

export default function ThemePreviewCard({ theme }: ThemePreviewCardProps) {
  const isDark = theme === "dark";

  return (
    <article
      className={`rounded-2xl border-2 p-3 transition-colors duration-300 ${
        isDark
          ? "border-[#1F2937]/25 bg-[#1F2937]"
          : "border-[#1F2937]/12 bg-white"
      }`}
    >
      <div
        className={`rounded-xl border p-3 transition-colors duration-300 ${
          isDark
            ? "border-[#3b4658] bg-[#2b3749]"
            : "border-[#1F2937]/10 bg-[#F7F7F7]"
        }`}
      >
        <div className="flex items-center justify-between">
          <div
            className={`h-2.5 w-20 rounded-full transition-colors duration-300 ${
              isDark ? "bg-[#5a6a82]" : "bg-[#d9dce2]"
            }`}
          />
          <div
            className={`h-6 w-6 rounded-full border transition-colors duration-300 ${
              isDark ? "border-[#ffd84d]/35 bg-[#ffd84d]/20" : "border-[#58CC02]/35 bg-[#58CC02]/20"
            }`}
          />
        </div>

        <div
          className={`mt-3 h-10 rounded-lg transition-colors duration-300 ${
            isDark ? "bg-[#3a4a61]" : "bg-[#e8ebf0]"
          }`}
        />

        <div className="mt-3 h-3 rounded-full bg-black/15">
          <div
            className={`h-full rounded-full transition-colors duration-300 ${
              isDark ? "bg-[#FFD84D]" : "bg-[#58CC02]"
            }`}
            style={{ width: "68%" }}
          />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div
            className={`h-8 rounded-md transition-colors duration-300 ${
              isDark ? "bg-[#435472]" : "bg-[#dde2ea]"
            }`}
          />
          <div
            className={`h-8 rounded-md transition-colors duration-300 ${
              isDark ? "bg-[#435472]" : "bg-[#dde2ea]"
            }`}
          />
          <div
            className={`h-8 rounded-md transition-colors duration-300 ${
              isDark ? "bg-[#435472]" : "bg-[#dde2ea]"
            }`}
          />
        </div>
      </div>
    </article>
  );
}
