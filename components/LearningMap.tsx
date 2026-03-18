"use client";

import ResourceDetailPanel from "@/components/ResourceDetailPanel";
import RouteMapCanvas from "@/components/RouteMapCanvas";
import RouteRatingCard from "@/components/RouteRatingCard";
import type { FieldLearningMap } from "@/lib/mockLearningMaps";
import { useMemo, useState } from "react";

type LearningMapProps = {
  map: FieldLearningMap | null;
};

type RouteState = {
  completedStepIds: string[];
  currentStepId: string | null;
  userRating: number | null;
  ratingMessage: string;
};

function makeRouteState(map: FieldLearningMap) {
  return map.routes.reduce<Record<string, RouteState>>((acc, route) => {
    acc[route.id] = {
      completedStepIds: [],
      currentStepId: route.steps[0]?.id ?? null,
      userRating: null,
      ratingMessage: "",
    };
    return acc;
  }, {});
}

export default function LearningMap({ map }: LearningMapProps) {
  const initialRouteId = map?.routes[0]?.id ?? "";
  const [selectedRouteId, setSelectedRouteId] = useState<string>(initialRouteId);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(
    map?.routes[0]?.steps[0]?.id ?? null,
  );
  const [routeState, setRouteState] = useState<Record<string, RouteState>>(
    map ? makeRouteState(map) : {},
  );

  const selectedRoute = useMemo(() => {
    if (!map) {
      return null;
    }
    return map.routes.find((route) => route.id === selectedRouteId) ?? map.routes[0] ?? null;
  }, [map, selectedRouteId]);

  const selectedStep = useMemo(() => {
    if (!selectedRoute || !selectedStepId) {
      return null;
    }
    return selectedRoute.steps.find((step) => step.id === selectedStepId) ?? null;
  }, [selectedRoute, selectedStepId]);

  const explorerPosition = useMemo(() => {
    if (!map || !selectedRoute) {
      return { x: 12, y: 82 };
    }

    const currentStepId = routeState[selectedRoute.id]?.currentStepId;
    const currentStep = selectedRoute.steps.find((step) => step.id === currentStepId);
    if (currentStep) {
      return { x: currentStep.x, y: currentStep.y };
    }

    return { x: map.palace.x - 1.8, y: map.palace.y + 8 };
  }, [map, routeState, selectedRoute]);

  function handleSelectRoute(routeId: string) {
    if (!map) {
      return;
    }
    const route = map.routes.find((item) => item.id === routeId);
    if (!route) {
      return;
    }

    setSelectedRouteId(route.id);
    const routeInfo = routeState[route.id];
    setSelectedStepId(routeInfo?.currentStepId ?? route.steps[0]?.id ?? null);
  }

  function handleSelectStep(routeId: string, stepId: string) {
    if (routeId !== selectedRouteId) {
      setSelectedRouteId(routeId);
    }
    setSelectedStepId(stepId);
  }

  function handleMarkStepCompleted() {
    if (!selectedRoute || !selectedStepId) {
      return;
    }

    const info = routeState[selectedRoute.id];
    if (!info) {
      return;
    }

    if (info.currentStepId !== selectedStepId) {
      return;
    }

    setRouteState((prev) => {
      const currentInfo = prev[selectedRoute.id];
      if (!currentInfo) {
        return prev;
      }

      if (currentInfo.completedStepIds.includes(selectedStepId)) {
        return prev;
      }

      const currentIndex = selectedRoute.steps.findIndex((step) => step.id === selectedStepId);
      const nextStep = selectedRoute.steps[currentIndex + 1];

      return {
        ...prev,
        [selectedRoute.id]: {
          ...currentInfo,
          completedStepIds: [...currentInfo.completedStepIds, selectedStepId],
          currentStepId: nextStep?.id ?? null,
        },
      };
    });

    const currentIndex = selectedRoute.steps.findIndex((step) => step.id === selectedStepId);
    const nextStep = selectedRoute.steps[currentIndex + 1];
    setSelectedStepId(nextStep?.id ?? selectedStepId);
  }

  function handleRateRoute(routeId: string, value: number) {
    setRouteState((prev) => ({
      ...prev,
      [routeId]: {
        ...prev[routeId],
        userRating: value,
        ratingMessage: "Thanks! Your rating was recorded locally.",
      },
    }));

    setTimeout(() => {
      setRouteState((prev) => ({
        ...prev,
        [routeId]: {
          ...prev[routeId],
          ratingMessage: "",
        },
      }));
    }, 1800);
  }

  if (!map) {
    return (
      <section className="rounded-[2rem] border-2 border-dashed border-[#1F2937]/25 bg-white p-8 text-center shadow-[0_8px_0_rgba(31,41,55,0.08)]">
        <h2 className="text-3xl font-extrabold text-[#1F2937]">
          No learning field selected
        </h2>
        <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">
          Choose a folder from the sidebar to begin your learning map.
        </p>
      </section>
    );
  }

  const selectedRouteInfo = selectedRoute ? routeState[selectedRoute.id] : null;
  const selectedRouteCompletedCount = selectedRouteInfo?.completedStepIds.length ?? 0;
  const selectedRouteTotal = selectedRoute?.steps.length ?? 0;
  const selectedRouteCurrentStepId = selectedRouteInfo?.currentStepId ?? null;
  const isSelectedStepCurrent = selectedStep ? selectedStep.id === selectedRouteCurrentStepId : false;
  const isSelectedStepCompleted = selectedStep
    ? (selectedRouteInfo?.completedStepIds ?? []).includes(selectedStep.id)
    : false;

  const totalCompletedSteps = map.routes.reduce((sum, route) => {
    return sum + (routeState[route.id]?.completedStepIds.length ?? 0);
  }, 0);
  const totalSteps = map.routes.reduce((sum, route) => sum + route.steps.length, 0);

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-extrabold text-[#1F2937]">{map.fieldTitle}</h2>
          <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">{map.subtitle}</p>
        </div>
        <p className="rounded-full border-2 border-[#1F2937]/15 bg-[#FFF9DD] px-4 py-2 text-sm font-extrabold text-[#1F2937]">
          Every small step grows your progress.
        </p>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <RouteMapCanvas
            map={map}
            selectedRouteId={selectedRouteId}
            selectedStepId={selectedStepId}
            completedStepIdsByRoute={Object.fromEntries(
              Object.entries(routeState).map(([routeId, info]) => [
                routeId,
                info.completedStepIds,
              ]),
            )}
            currentStepIdByRoute={Object.fromEntries(
              Object.entries(routeState).map(([routeId, info]) => [
                routeId,
                info.currentStepId,
              ]),
            )}
            explorerPosition={explorerPosition}
            onSelectRoute={handleSelectRoute}
            onSelectStep={handleSelectStep}
          />

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {map.routes.map((route) => {
              const info = routeState[route.id];
              const isCompleted = (info?.completedStepIds.length ?? 0) >= route.steps.length;
              return (
                <RouteRatingCard
                  key={route.id}
                  route={route}
                  isActive={selectedRouteId === route.id}
                  isRouteCompleted={isCompleted}
                  userRating={info?.userRating ?? null}
                  onSelectRoute={() => handleSelectRoute(route.id)}
                  onRateRoute={(value) => handleRateRoute(route.id, value)}
                  successMessage={info?.ratingMessage ?? ""}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F6FCFF] p-4">
            <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
              Progress Summary
            </p>
            <p className="mt-2 text-base font-extrabold text-[#1F2937]">
              Current route: {selectedRoute?.name ?? "None"}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
              Completed steps: {selectedRouteCompletedCount}/{selectedRouteTotal}
            </p>
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
              Overall map: {totalCompletedSteps}/{totalSteps} steps
            </p>
            <p className="mt-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#1F2937]/70">
              Next milestone:{" "}
              {selectedRouteCurrentStepId
                ? selectedRoute?.steps.find((step) => step.id === selectedRouteCurrentStepId)
                    ?.title
                : "Reach your next mastery milestone"}
            </p>
          </div>

          <ResourceDetailPanel
            step={selectedStep}
            isCurrentStep={isSelectedStepCurrent}
            isCompletedStep={isSelectedStepCompleted}
            onMarkCompleted={handleMarkStepCompleted}
          />
        </div>
      </div>
    </section>
  );
}
