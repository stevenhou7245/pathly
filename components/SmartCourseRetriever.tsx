"use client";

import { useState } from "react";
import { fetchCourseByTopic } from "@/lib/client/getCourse";
import type { CourseWithResources } from "@/lib/courseRetrieval/types";

export default function SmartCourseRetriever() {
  const [topic, setTopic] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState<"cache" | "database" | "ai_generated" | null>(null);
  const [result, setResult] = useState<CourseWithResources | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setError("Please enter a topic.");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const result = await fetchCourseByTopic(normalizedTopic);
      setResult(result.data);
      setSource(result.source);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load course.");
      setResult(null);
      setSource(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-5">
      <h2 className="text-xl font-extrabold text-[#1F2937]">Smart Course Retrieval</h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap gap-3">
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Enter a topic (e.g. React, Python)"
          className="min-w-[260px] flex-1 rounded-xl border-2 border-[#1F2937]/15 px-3 py-2 text-sm font-semibold text-[#1F2937]"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 text-sm disabled:opacity-70"
        >
          {isLoading ? "Loading..." : "Get Course"}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {error}
        </p >
      )}

      {result && (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border-2 border-[#1F2937]/10 bg-[#F8FCFF] p-4">
            <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
              {source === "database"
                ? "From database"
                : source === "cache"
                ? "From cache"
                : "AI generated"}
            </p >
            <h3 className="mt-1 text-lg font-extrabold text-[#1F2937]">{result.course.title}</h3>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/75">
              {result.course.description ?? "No description."}
            </p >
            <p className="mt-2 text-xs font-bold text-[#1F2937]/60">
              Difficulty: {result.course.difficulty_level ?? "Unknown"} · Estimated:{" "}
              {result.course.estimated_minutes ?? "-"} min
            </p >
          </div>

          <div className="space-y-3">
            {result.resources.map((resource, index) => (
              <article key={resource.id} className="rounded-xl border-2 border-[#1F2937]/10 p-4">
                <h4 className="text-base font-extrabold text-[#1F2937]">
                  {index + 1}. {resource.title}
                </h4>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[#1F2937]/60">
                  {resource.resource_type} · {resource.provider}
                </p >
                <p className="mt-2 text-sm font-semibold text-[#1F2937]/75">
                  {resource.summary ?? "No summary."}
                </p >
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex text-sm font-bold text-[#2f7d14] underline"
                >
                  Open Resource
                </a >
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
