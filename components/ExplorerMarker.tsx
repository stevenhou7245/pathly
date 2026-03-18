type ExplorerMarkerProps = {
  x: number;
  y: number;
};

export default function ExplorerMarker({ x, y }: ExplorerMarkerProps) {
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[110%] transition-all duration-500 ease-out"
      style={{ left: `${x}%`, top: `${y}%` }}
      aria-hidden="true"
    >
      <div className="relative">
        <div className="h-9 w-9 rounded-full border-2 border-[#1F2937] bg-[#FFD84D] shadow-[0_3px_0_#1F2937]" />
        <div className="absolute left-1/2 top-2 h-4 w-4 -translate-x-1/2 rounded-full bg-[#FFEAA6]" />
        <div className="absolute -bottom-2 left-1/2 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-[#1F2937] bg-[#58CC02]" />
      </div>
    </div>
  );
}
