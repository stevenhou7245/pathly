type MasteryGoalProps = {
  x: number;
  y: number;
  label: string;
};

export default function MasteryGoal({ x, y, label }: MasteryGoalProps) {
  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="relative flex h-20 w-24 flex-col items-center justify-end rounded-2xl border-2 border-[#1F2937] bg-[#FFD84D] pb-2 shadow-[0_4px_0_#1F2937]">
        <div className="absolute -top-4 h-4 w-16 rounded-t-full border-2 border-[#1F2937] bg-[#FFF3BE]" />
        <div className="flex gap-1.5">
          <span className="h-7 w-2.5 rounded-full bg-[#FFF8D7]" />
          <span className="h-7 w-2.5 rounded-full bg-[#FFF8D7]" />
          <span className="h-7 w-2.5 rounded-full bg-[#FFF8D7]" />
          <span className="h-7 w-2.5 rounded-full bg-[#FFF8D7]" />
        </div>
      </div>
      <p className="mt-1 rounded-full border border-[#1F2937]/25 bg-white px-2 py-0.5 text-center text-[11px] font-extrabold text-[#1F2937]">
        {label}
      </p>
    </div>
  );
}
