"use client";

import FaqAccordion, { type FaqItem } from "@/components/FaqAccordion";
import Link from "next/link";
import { useMemo, useState } from "react";

const FAQ_ITEMS: FaqItem[] = [
  {
    id: "account-create",
    category: "Account & Login",
    question: "How do I create an account?",
    answer:
      "Click Sign Up, fill in your details, verify your code, and submit the form. You can then log in and begin your learning journey.",
  },
  {
    id: "account-forgot-password",
    category: "Account & Login",
    question: "I forgot my password. What should I do?",
    answer:
      "Use the Forgot password link on the login page. Enter your email, receive a verification code, and set a new password.",
  },
  {
    id: "account-need-login",
    category: "Account & Login",
    question: "Why do I need to log in before exploring?",
    answer:
      "Logging in lets Pathly save your map, progress, and route choices, so your path continues where you left off.",
  },
  {
    id: "path-choose-field",
    category: "Learning Paths",
    question: "How do I choose a learning field?",
    answer:
      "Go to Explore, search or pick a popular destination, and create your path. Pathly then prepares your learning map.",
  },
  {
    id: "path-multiple-routes",
    category: "Learning Paths",
    question: "Can I study one topic through different routes?",
    answer:
      "Yes. A field can have multiple routes with different resource order, so you can pick the path that fits your style.",
  },
  {
    id: "path-multiple-valid-routes",
    category: "Learning Paths",
    question: "Why are there multiple learning routes?",
    answer:
      "Different learners progress differently. Pathly offers multiple valid routes so you can reach the same goal in your own way.",
  },
  {
    id: "progress-move-forward",
    category: "Progress & Ratings",
    question: "How do I move forward on the map?",
    answer:
      "Open the current resource, complete it, then click Mark as Completed. Your explorer moves forward one step.",
  },
  {
    id: "progress-complete-resource",
    category: "Progress & Ratings",
    question: "What happens when I complete a resource?",
    answer:
      "That step becomes completed, your progress summary updates, and the next step becomes your active milestone.",
  },
  {
    id: "progress-rate-route",
    category: "Progress & Ratings",
    question: "Can I rate a learning route?",
    answer:
      "Yes. After finishing a route, you can submit a 1-5 star rating. This helps others discover useful paths.",
  },
  {
    id: "progress-rating-benefit",
    category: "Progress & Ratings",
    question: "How do route ratings help other users?",
    answer:
      "Ratings signal route quality and popularity, helping other explorers pick routes that worked well for similar learners.",
  },
  {
    id: "friends-add-view",
    category: "Friends & Chat",
    question: "How do I add or view friends?",
    answer:
      "Open Utilities > Friends to view your list. You can select a friend, view status, and track their learning field.",
  },
  {
    id: "friends-chat",
    category: "Friends & Chat",
    question: "Can I chat with friends while learning?",
    answer:
      "Yes. The friends panel includes a chat area for quick messages and study check-ins during your learning journey.",
  },
  {
    id: "settings-sound",
    category: "Settings & Experience",
    question: "How do I turn off sound effects?",
    answer:
      "Open Utilities > More > Settings, then switch off Sound effects under Learning Experience.",
  },
  {
    id: "settings-theme",
    category: "Settings & Experience",
    question: "How do I switch between light mode and dark mode?",
    answer:
      "In Settings > Theme Mode, choose Light or Dark. The preview card updates to show the selected interface style.",
  },
];

const FAQ_CATEGORIES = [
  "All",
  "Account & Login",
  "Learning Paths",
  "Progress & Ratings",
  "Friends & Chat",
  "Settings & Experience",
];

export default function FaqHelpContent() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    FAQ_ITEMS.forEach((item) => {
      map.set(item.category, (map.get(item.category) ?? 0) + 1);
    });
    return map;
  }, []);

  return (
    <section className="space-y-5">
      <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
        <label htmlFor="faq-search" className="mb-2 block text-sm font-bold text-[#1F2937]">
          Search help topics
        </label>
        <input
          id="faq-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search help topics..."
          className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-[#F7FCFF] px-4 py-3 text-base font-semibold text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/40 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
        />
      </article>

      <article className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-5 shadow-[0_5px_0_rgba(31,41,55,0.08)]">
        <h2 className="text-2xl font-extrabold text-[#1F2937]">FAQ Categories</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {FAQ_CATEGORIES.map((category) => {
            const isActive = activeCategory === category;
            const count = category === "All" ? FAQ_ITEMS.length : categoryCounts.get(category) ?? 0;
            return (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`rounded-2xl border-2 px-4 py-3 text-left transition ${
                  isActive
                    ? "border-[#1F2937] bg-[#58CC02]/12 shadow-[0_4px_0_rgba(31,41,55,0.2)]"
                    : "border-[#1F2937]/12 bg-[#F7FCFF] hover:-translate-y-0.5 hover:border-[#58CC02]/45"
                }`}
              >
                <p className="text-sm font-extrabold text-[#1F2937]">{category}</p>
                <p className="mt-1 text-xs font-semibold text-[#1F2937]/62">{count} topics</p>
              </button>
            );
          })}
        </div>
      </article>

      <article className="space-y-3">
        <h2 className="text-2xl font-extrabold text-[#1F2937]">Answers</h2>
        <FaqAccordion items={FAQ_ITEMS} query={query} activeCategory={activeCategory} />
      </article>

      <article className="rounded-3xl border-2 border-[#1F2937] bg-white p-6 text-center shadow-[0_8px_0_#1F2937,0_16px_24px_rgba(31,41,55,0.12)]">
        <p className="text-2xl font-extrabold text-[#1F2937]">Still need help?</p>
        <p className="mt-2 text-sm font-semibold text-[#1F2937]/68">
          Our support team can guide you back to the right path.
        </p>
        <Link
          href="/help/contact-support"
          className="btn-3d btn-3d-green mt-4 inline-flex h-11 items-center justify-center px-6 !text-base"
        >
          Contact Support
        </Link>
      </article>
    </section>
  );
}

