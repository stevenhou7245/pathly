import type { LearningRoute } from "@/lib/mockLearningMaps";

type RouteRatingCardProps = {
  route: LearningRoute;
  isActive: boolean;
  isRouteCompleted: boolean;
  userRating: number | null;
  onSelectRoute: () => void;
  onRateRoute: (value: number) => void;
  successMessage: string;
};

function renderStars(value: number) {
  return "★".repeat(value);
}

export default function RouteRatingCard({
  route,
  isActive,
  isRouteCompleted,
  userRating,
  onSelectRoute,
  onRateRoute,
  successMessage,
}: RouteRatingCardProps) {
  return (
    <article
      className={`rounded-2xl border-2 p-4 transition ${
        isActive
          ? "border-[#1F2937] bg-white shadow-[0_4px_0_#1F2937]"
          : "border-[#1F2937]/12 bg-white hover:border-[#58CC02]/35"
      }`}
    >
      <button type="button" onClick={onSelectRoute} className="w-full text-left">
        <p className="text-base font-extrabold text-[#1F2937]">{route.name}</p>
        <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">{route.popularityHint}</p>
        <p className="mt-2 text-sm font-bold text-[#1F2937]">
          {route.averageRating.toFixed(1)} / 5 ({route.ratingCount} ratings)
        </p>
      </button>

      {isRouteCompleted ? (
        <div className="mt-3 rounded-xl border border-[#1F2937]/10 bg-[#F6FCFF] p-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
            Rate this road
          </p>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={`${route.id}-${value}`}
                type="button"
                onClick={() => onRateRoute(value)}
                className={`rounded-md px-1 text-lg transition ${
                  (userRating ?? 0) >= value ? "text-[#FFD84D]" : "text-[#1F2937]/25 hover:text-[#FFD84D]/70"
                }`}
                aria-label={`Rate ${value} star${value > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
          </div>
          {userRating ? (
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
              Your rating: {renderStars(userRating)}
            </p>
          ) : null}
          {successMessage ? (
            <p className="mt-2 rounded-lg bg-[#ecffe1] px-2 py-1 text-xs font-bold text-[#2f7d14]">
              {successMessage}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-[#FFF9DD] px-2.5 py-1.5 text-xs font-bold text-[#1F2937]/70">
          Complete all steps in this route to unlock rating.
        </p>
      )}
    </article>
  );
}
