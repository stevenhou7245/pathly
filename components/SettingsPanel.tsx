import ThemeModeToggle from "@/components/ThemeModeToggle";
import ThemePreviewCard from "@/components/ThemePreviewCard";

type SettingsPanelProps = {
  soundEffects: boolean;
  animations: boolean;
  themeMode: "light" | "dark";
  onToggleSoundEffects: () => void;
  onToggleAnimations: () => void;
  onSetThemeMode: (mode: "light" | "dark") => void;
  disabled?: boolean;
};

function Toggle({
  checked,
  onToggle,
  label,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border-2 border-[#1F2937]/12 bg-white px-4 py-3">
      <p className="text-sm font-bold text-[#1F2937]">{label}</p>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={checked}
        className={`relative inline-flex h-8 w-14 items-center rounded-full border-2 transition ${
          checked
            ? "border-[#1F2937] bg-[#58CC02]"
            : "border-[#1F2937]/20 bg-zinc-200"
        } disabled:cursor-not-allowed disabled:opacity-70`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "translate-x-7" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export default function SettingsPanel({
  soundEffects,
  animations,
  themeMode,
  onToggleSoundEffects,
  onToggleAnimations,
  onSetThemeMode,
  disabled = false,
}: SettingsPanelProps) {
  return (
    <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-[#F6FCFF] p-5">
      <h3 className="text-2xl font-extrabold text-[#1F2937]">Settings</h3>
      <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
        Tune your learning environment the way you like.
      </p>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <section className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Learning Experience
          </h4>
          <div className="mt-3 space-y-3">
            <Toggle
              checked={soundEffects}
              onToggle={onToggleSoundEffects}
              label="Sound effects"
              disabled={disabled}
            />
            <Toggle
              checked={animations}
              onToggle={onToggleAnimations}
              label="Animations"
              disabled={disabled}
            />
          </div>
        </section>

        <section className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
          <h4 className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Theme Mode
          </h4>
          <p className="mt-3 text-sm font-semibold text-[#1F2937]/65">
            Choose a look for your dashboard.
          </p>

          <div className="mt-3">
            <ThemeModeToggle
              themeMode={themeMode}
              onSetThemeMode={onSetThemeMode}
              disabled={disabled}
            />
          </div>

          <div className="mt-4">
            <ThemePreviewCard theme={themeMode} />
          </div>
        </section>
      </div>
    </article>
  );
}
