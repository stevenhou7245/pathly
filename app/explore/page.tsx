"use client";

import { saveSelectedLearningField } from "@/lib/mockClientState";
import BrandLogo from "@/components/BrandLogo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type PopularPath = {
  id: string;
  icon: string;
  title: string;
  description: string;
};

const POPULAR_PATHS: PopularPath[] = [
  {
    id: "web-development",
    icon: "</>",
    title: "Web Development",
    description: "Build websites and full-stack products.",
  },
  {
    id: "machine-learning",
    icon: "AI",
    title: "Machine Learning",
    description: "Train models and solve real-world tasks.",
  },
  {
    id: "ielts",
    icon: "EN",
    title: "IELTS",
    description: "Boost speaking, writing, and test confidence.",
  },
  {
    id: "data-science",
    icon: "DS",
    title: "Data Science",
    description: "Turn messy data into useful insights.",
  },
  {
    id: "ui-design",
    icon: "UI",
    title: "UI Design",
    description: "Craft polished interfaces with strong UX.",
  },
  {
    id: "vibe-coding",
    icon: "VC",
    title: "Vibe Coding",
    description: "Prototype fast and build with creative flow.",
  },
];

export default function ExplorePage() {
  const router = useRouter();
  const [topicInput, setTopicInput] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [isBuildingRoad, setIsBuildingRoad] = useState(false);
  const [emptyMessage, setEmptyMessage] = useState("");
  const redirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const finalTopic = useMemo(() => {
    const typed = topicInput.trim();
    if (typed) {
      return typed;
    }
    return selectedTopic;
  }, [topicInput, selectedTopic]);

  function handleSelectPath(pathTitle: string) {
    setSelectedTopic(pathTitle);
    setTopicInput(pathTitle);
    setEmptyMessage("");
  }

  function handleCreateRoad() {
    const topic = finalTopic.trim();
    if (!topic) {
      setEmptyMessage("Choose or enter a destination to create your path.");
      return;
    }

    setEmptyMessage("");
    setIsBuildingRoad(true);
    saveSelectedLearningField(topic);

    redirectTimerRef.current = window.setTimeout(() => {
      router.push(`/dashboard?field=${encodeURIComponent(topic)}`);
    }, 2000);
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7] text-[#1F2937]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-black/5 bg-white/95 shadow-sm backdrop-blur">
        <nav className="mx-auto flex min-h-20 w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <BrandLogo />
          </Link>
          <Link
            href="/"
            className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 text-base"
          >
            Back
          </Link>
        </nav>
      </header>

      <main className="relative overflow-hidden pb-12 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-4%] top-24 h-36 w-36 rounded-full bg-[#FFD84D]/25 blur-sm" />
          <div className="absolute right-[-2%] top-40 h-28 w-28 rounded-full bg-[#58CC02]/20 blur-sm" />
          <div className="absolute bottom-0 left-0 h-36 w-64 rounded-tr-[5rem] bg-[#58CC02]/12" />
          <div className="absolute bottom-0 right-0 h-28 w-56 rounded-tl-[4.5rem] bg-[#FFD84D]/18" />
          <div className="absolute left-[12%] top-20 h-8 w-20 rounded-full bg-white/85" />
          <div className="absolute right-[14%] top-16 h-9 w-24 rounded-full bg-white/80" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-6 sm:px-8">
          <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_10px_0_#1F2937,0_20px_28px_rgba(31,41,55,0.12)] sm:p-8">
            <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
              Choose Your Destination
            </p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-[#1F2937] sm:text-5xl">
              Where does your path begin?
            </h1>
            <p className="mt-3 max-w-3xl text-lg font-semibold text-[#1F2937]/72">
              Choose a learning destination and start your Pathly journey.
            </p>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/62">
              Every path can lead to progress. Your map grows with every step.
            </p>

            <div className="mt-6 rounded-3xl border-2 border-[#1F2937]/12 bg-[#F6FCFF] p-4 sm:p-5">
              <label
                htmlFor="learning-destination"
                className="mb-2 block text-sm font-bold text-[#1F2937]"
              >
                Search your learning destination
              </label>
              <input
                id="learning-destination"
                type="search"
                list="explore-topic-options"
                value={topicInput}
                onChange={(event) => {
                  setTopicInput(event.target.value);
                  setEmptyMessage("");
                }}
                placeholder="Web Development, Machine Learning, IELTS, Python, Product Design, Vibe Coding"
                className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base font-semibold text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
              />
              <datalist id="explore-topic-options">
                <option value="Web Development" />
                <option value="Machine Learning" />
                <option value="IELTS" />
                <option value="Python" />
                <option value="Product Design" />
                <option value="Vibe Coding" />
              </datalist>
            </div>

            <div className="mt-8">
              <h2 className="text-2xl font-extrabold text-[#1F2937]">Popular Learning Paths</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {POPULAR_PATHS.map((path) => {
                  const isActive = finalTopic.toLowerCase() === path.title.toLowerCase();
                  return (
                    <article
                      key={path.id}
                      className={`rounded-3xl border-2 p-4 shadow-[0_4px_0_rgba(31,41,55,0.08)] transition hover:-translate-y-0.5 ${
                        isActive
                          ? "border-[#1F2937] bg-[#58CC02]/12"
                          : "border-[#1F2937]/12 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[#FFD84D] text-sm font-extrabold text-[#1F2937]">
                          {path.icon}
                        </span>
                        {isActive ? (
                          <span className="rounded-full bg-[#58CC02] px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
                            Selected
                          </span>
                        ) : null}
                      </div>
                      <h3 className="mt-3 text-lg font-extrabold text-[#1F2937]">{path.title}</h3>
                      <p className="mt-1 text-sm font-semibold text-[#1F2937]/68">
                        {path.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleSelectPath(path.title)}
                        className="btn-3d btn-3d-white mt-4 inline-flex h-10 items-center justify-center px-5"
                      >
                        Explore
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="mt-8 rounded-2xl border-2 border-dashed border-[#1F2937]/15 bg-[#FFFDF2] p-4">
              <p className="text-sm font-bold text-[#1F2937]/75">
                Selected destination:{" "}
                <span className="text-[#1F2937]">{finalTopic || "No destination selected yet."}</span>
              </p>
              <p className="mt-1 text-sm font-semibold text-[#1F2937]/62">
                Pick a destination and begin your first quest.
              </p>

              <button
                type="button"
                onClick={handleCreateRoad}
                disabled={isBuildingRoad}
                className="btn-3d btn-3d-green mt-4 inline-flex h-12 items-center justify-center px-7 text-base transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isBuildingRoad ? "Building..." : "Create My Learning Path"}
              </button>

              {emptyMessage ? (
                <p className="mt-3 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
                  {emptyMessage}
                </p>
              ) : null}
            </div>
          </section>

          {isBuildingRoad ? (
            <section className="mt-6 rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_8px_0_#1F2937,0_18px_24px_rgba(31,41,55,0.12)] sm:p-7">
              <h2 className="text-2xl font-extrabold text-[#1F2937]">
                Building your learning path...
              </h2>
              <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">
                Preparing milestones for <span className="text-[#1F2937]">{finalTopic}</span>.
              </p>
              <svg
                viewBox="0 0 620 170"
                className="mt-4 h-auto w-full"
                role="img"
                aria-label="Path creation progress"
              >
                <path
                  d="M26 132 C144 66 278 58 346 88 C422 122 530 112 592 64"
                  stroke="#FFF2A8"
                  strokeWidth="54"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M34 132 C150 73 278 67 346 95 C422 127 528 118 586 71"
                  stroke="#F3CF22"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="10 11"
                  fill="none"
                />
                <rect x="212" y="78" width="8" height="22" rx="3" fill="#58CC02" />
                <polygon points="220,78 238,84 220,91" fill="#FFD84D" />
                <rect x="402" y="100" width="8" height="22" rx="3" fill="#58CC02" />
                <polygon points="410,100 428,106 410,113" fill="#FFD84D" />
                <circle cx="84" cy="130" r="14" fill="#58CC02" />
                <circle cx="84" cy="130" r="7" fill="#FFD84D" />
                <ellipse cx="570" cy="47" rx="34" ry="20" fill="#FFD84D" />
                <rect x="546" y="39" width="48" height="20" rx="5" fill="#ffce2f" />
                <g fill="#B46D0F">
                  <rect x="553" y="41" width="6" height="18" rx="3" />
                  <rect x="563" y="40" width="6" height="19" rx="3" />
                  <rect x="573" y="40" width="6" height="19" rx="3" />
                  <rect x="583" y="41" width="6" height="18" rx="3" />
                </g>
              </svg>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

