"use client";

export const SELECTED_FIELD_KEY = "pathly-selected-learning-field";

export function saveSelectedLearningField(field: string) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(SELECTED_FIELD_KEY, field);
}
