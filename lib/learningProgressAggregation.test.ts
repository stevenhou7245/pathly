import assert from "node:assert/strict";
import test from "node:test";
import {
  computeProgressPercent,
  filterAndLimitRecentCompletedRows,
  isRealCompletedCourseRow,
} from "@/lib/learningProgressAggregation";

test("Case 1: no started/completed course rows => empty recent completions", () => {
  const rows = [
    { status: "unlocked", completed_at: null },
    { status: "not_started", completed_at: null },
  ];

  const filtered = filterAndLimitRecentCompletedRows(rows, 3);
  assert.equal(filtered.length, 0);
});

test("Case 2: in_progress row without completed_at is excluded", () => {
  const row = {
    status: "in_progress",
    completed_at: null,
  };

  assert.equal(isRealCompletedCourseRow(row), false);
});

test("Case 3: truly completed row with completed_at is included", () => {
  const completedAt = "2026-03-16T10:00:00.000Z";
  const row = {
    status: "passed",
    completed_at: completedAt,
  };

  assert.equal(isRealCompletedCourseRow(row), true);

  const filtered = filterAndLimitRecentCompletedRows([row], 3);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].completed_at, completedAt);
});

test("Case 4: progress percentage math stays aligned with folder/top summary math", () => {
  assert.equal(computeProgressPercent({ completedSteps: 1, totalSteps: 14 }), 7);
  assert.equal(computeProgressPercent({ completedSteps: 2, totalSteps: 5 }), 40);
  assert.equal(computeProgressPercent({ completedSteps: 0, totalSteps: 0 }), 0);
});

test("Case 5: limiting keeps latest completed rows only", () => {
  const rows = [
    { status: "passed", completed_at: "2026-03-16T12:00:00.000Z" },
    { status: "passed", completed_at: "2026-03-15T12:00:00.000Z" },
    { status: "passed", completed_at: "2026-03-14T12:00:00.000Z" },
    { status: "passed", completed_at: "2026-03-13T12:00:00.000Z" },
  ];

  const filtered = filterAndLimitRecentCompletedRows(rows, 3);
  assert.equal(filtered.length, 3);
  assert.equal(filtered[0].completed_at, "2026-03-16T12:00:00.000Z");
  assert.equal(filtered[2].completed_at, "2026-03-14T12:00:00.000Z");
});
