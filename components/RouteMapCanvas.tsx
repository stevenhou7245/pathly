import ExplorerMarker from "@/components/ExplorerMarker";
import MasteryGoal from "@/components/MasteryGoal";
import ResourceStepNode, { type StepVisualState } from "@/components/ResourceStepNode";
import type { FieldLearningMap, LearningRoute, LearningStep } from "@/lib/mockLearningMaps";

type RouteMapCanvasProps = {
  map: FieldLearningMap;
  selectedRouteId: string;
  selectedStepId: string | null;
  completedStepIdsByRoute: Record<string, string[]>;
  currentStepIdByRoute: Record<string, string | null>;
  explorerPosition: { x: number; y: number };
  onSelectRoute: (routeId: string) => void;
  onSelectStep: (routeId: string, stepId: string) => void;
};

function getStepState(
  route: LearningRoute,
  step: LearningStep,
  completedStepIdsByRoute: Record<string, string[]>,
  currentStepIdByRoute: Record<string, string | null>,
): StepVisualState {
  const completedIds = completedStepIdsByRoute[route.id] ?? [];
  if (completedIds.includes(step.id)) {
    return "completed";
  }

  if (currentStepIdByRoute[route.id] === step.id) {
    return "current";
  }

  return "upcoming";
}

export default function RouteMapCanvas({
  map,
  selectedRouteId,
  selectedStepId,
  completedStepIdsByRoute,
  currentStepIdByRoute,
  explorerPosition,
  onSelectRoute,
  onSelectStep,
}: RouteMapCanvasProps) {
  return (
    <div className="relative min-h-[380px] overflow-hidden rounded-3xl border-2 border-[#1F2937]/12 bg-[#EAF7FF] p-4 sm:min-h-[460px] sm:p-5">
      <div className="absolute left-8 top-7 h-7 w-20 rounded-full bg-white/90" />
      <div className="absolute left-14 top-4 h-8 w-8 rounded-full bg-white/90" />
      <div className="absolute right-16 top-5 h-8 w-24 rounded-full bg-white/85" />
      <div className="absolute right-24 top-2 h-9 w-9 rounded-full bg-white/85" />

      <div className="absolute bottom-0 left-0 h-24 w-48 rounded-tr-[4rem] bg-[#58CC02]/25" />
      <div className="absolute bottom-0 right-0 h-20 w-44 rounded-tl-[3.5rem] bg-[#FFD84D]/28" />

      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" role="img" aria-label="Learning map with multiple paths and milestones">
        {map.routes.map((route) => {
          const isSelectedRoute = route.id === selectedRouteId;

          return (
            <g key={route.id}>
              <path
                d={route.pathD}
                fill="none"
                stroke="#1F2937"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity={isSelectedRoute ? 0.6 : 0.22}
                onClick={() => onSelectRoute(route.id)}
              />
              <path
                d={route.pathD}
                fill="none"
                stroke={route.pathColor}
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity={isSelectedRoute ? 0.95 : 0.45}
                onClick={() => onSelectRoute(route.id)}
              />
            </g>
          );
        })}
      </svg>

      <MasteryGoal x={map.palace.x} y={map.palace.y} label={map.palace.label} />

      {map.routes.map((route) =>
        route.steps.map((step) => (
          <ResourceStepNode
            key={step.id}
            step={step}
            isSelected={selectedStepId === step.id}
            state={getStepState(route, step, completedStepIdsByRoute, currentStepIdByRoute)}
            onClick={() => {
              onSelectRoute(route.id);
              onSelectStep(route.id, step.id);
            }}
          />
        )),
      )}

      <ExplorerMarker x={explorerPosition.x} y={explorerPosition.y} />
    </div>
  );
}
