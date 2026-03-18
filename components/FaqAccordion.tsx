"use client";

import { useMemo, useState } from "react";

export type FaqItem = {
  id: string;
  category: string;
  question: string;
  answer: string;
};

type FaqAccordionProps = {
  items: FaqItem[];
  query: string;
  activeCategory: string;
};

function matchesQuery(item: FaqItem, query: string) {
  if (!query.trim()) {
    return true;
  }

  const keyword = query.trim().toLowerCase();
  return (
    item.question.toLowerCase().includes(keyword) ||
    item.answer.toLowerCase().includes(keyword) ||
    item.category.toLowerCase().includes(keyword)
  );
}

export default function FaqAccordion({ items, query, activeCategory }: FaqAccordionProps) {
  const [openItemId, setOpenItemId] = useState<string>(items[0]?.id ?? "");

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeCategory !== "All" && item.category !== activeCategory) {
        return false;
      }
      return matchesQuery(item, query);
    });
  }, [items, query, activeCategory]);

  if (filteredItems.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-[#1F2937]/18 bg-white p-5 text-center">
        <p className="text-lg font-extrabold text-[#1F2937]">No matching topics yet</p>
        <p className="mt-1 text-sm font-semibold text-[#1F2937]/65">
          Try another keyword or switch category.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filteredItems.map((item) => {
        const isOpen = openItemId === item.id;
        return (
          <article
            key={item.id}
            className="overflow-hidden rounded-3xl border-2 border-[#1F2937]/12 bg-white shadow-[0_4px_0_rgba(31,41,55,0.08)] transition hover:-translate-y-0.5"
          >
            <button
              type="button"
              onClick={() => setOpenItemId((prev) => (prev === item.id ? "" : item.id))}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#58CC02]">
                  {item.category}
                </p>
                <h3 className="mt-1 text-base font-extrabold text-[#1F2937]">{item.question}</h3>
              </div>
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#1F2937]/20 bg-[#FFF7CF] text-[#1F2937] transition-transform duration-300 ${
                  isOpen ? "rotate-45" : ""
                }`}
                aria-hidden="true"
              >
                +
              </span>
            </button>

            <div
              className="grid overflow-hidden px-5 transition-[grid-template-rows] duration-300"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="overflow-hidden">
                <p
                  className={`pb-4 text-sm font-semibold text-[#1F2937]/72 transition-opacity duration-300 ${
                    isOpen ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {item.answer}
                </p>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
