type ThemeModeToggleProps = {
  themeMode: "light" | "dark";
  onSetThemeMode: (mode: "light" | "dark") => void;
  disabled?: boolean;
};

export default function ThemeModeToggle({
  themeMode,
  onSetThemeMode,
  disabled = false,
}: ThemeModeToggleProps) {
  return (
    <div
      className={`inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#F7F7F7] p-1 ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSetThemeMode("light")}
        className={`rounded-full px-4 py-2 text-sm font-bold transition-colors duration-300 ${
          themeMode === "light"
            ? "bg-[#FFD84D] text-[#1F2937]"
            : "text-[#1F2937]/70 hover:bg-white"
        } disabled:cursor-not-allowed`}
      >
        Light
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSetThemeMode("dark")}
        className={`rounded-full px-4 py-2 text-sm font-bold transition-colors duration-300 ${
          themeMode === "dark"
            ? "bg-[#58CC02] text-white"
            : "text-[#1F2937]/70 hover:bg-white"
        } disabled:cursor-not-allowed`}
      >
        Dark
      </button>
    </div>
  );
}
