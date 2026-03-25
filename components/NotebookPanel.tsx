"use client";

import { useEffect, useMemo, useState } from "react";

type NotebookRecord = {
  id: string;
  user_id: string;
  topic: string;
  content_md: string | null;
  source_type: "manual" | "study_room_exit_save" | "study_room_manual_save";
  source_room_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_deleted: boolean;
};

type NotebooksResponse = {
  success: boolean;
  message?: string;
  notebooks?: NotebookRecord[];
  notebook?: NotebookRecord;
};

type NotebookPanelProps = {
  folderName: string;
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Unknown time";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown time";
  }
  return parsed.toLocaleString();
}

function sortNotebooks(items: NotebookRecord[]) {
  return [...items].sort((a, b) => {
    const updatedCompare = (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    if (updatedCompare !== 0) {
      return updatedCompare;
    }
    return a.topic.localeCompare(b.topic);
  });
}

export default function NotebookPanel({ folderName }: NotebookPanelProps) {
  const [notebooks, setNotebooks] = useState<NotebookRecord[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [isAddTopicOpen, setIsAddTopicOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [contentDraft, setContentDraft] = useState("");
  const [topicDraft, setTopicDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  const sortedNotebooks = useMemo(() => sortNotebooks(notebooks), [notebooks]);

  const selectedNotebook = useMemo(
    () => sortedNotebooks.find((item) => item.id === selectedNotebookId) ?? null,
    [selectedNotebookId, sortedNotebooks],
  );

  async function loadNotebooks() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/notebooks", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as NotebooksResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load notebooks.");
      }
      const rows = sortNotebooks(payload.notebooks ?? []);
      setNotebooks(rows);
      const first = rows[0] ?? null;
      setSelectedNotebookId(first?.id ?? "");
      setTopicDraft(first?.topic ?? "");
      setContentDraft(first?.content_md ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load notebooks.");
      setNotebooks([]);
      setSelectedNotebookId("");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateNotebook() {
    const normalizedTopic = newTopic.trim();
    if (!normalizedTopic) {
      setError("Please enter a note topic first.");
      return;
    }
    setIsCreating(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/notebooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: normalizedTopic,
          content_md: "",
          source_type: "manual",
        }),
      });
      const payload = (await response.json()) as NotebooksResponse;
      if (!response.ok || !payload.success || !payload.notebook) {
        throw new Error(payload.message ?? "Unable to create notebook.");
      }
      const next = sortNotebooks([payload.notebook, ...notebooks]);
      setNotebooks(next);
      setSelectedNotebookId(payload.notebook.id);
      setTopicDraft(payload.notebook.topic);
      setContentDraft(payload.notebook.content_md ?? "");
      setNewTopic("");
      setIsAddTopicOpen(false);
      setMessage("Notebook created. You can start writing now.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create notebook.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSaveNotebook() {
    if (!selectedNotebook) {
      return;
    }
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(selectedNotebook.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: topicDraft,
          content_md: contentDraft,
        }),
      });
      const payload = (await response.json()) as NotebooksResponse;
      if (!response.ok || !payload.success || !payload.notebook) {
        throw new Error(payload.message ?? "Unable to save notebook.");
      }
      const next = sortNotebooks(
        notebooks.map((item) => (item.id === payload.notebook?.id ? payload.notebook : item)),
      );
      setNotebooks(next);
      setSelectedNotebookId(payload.notebook.id);
      setTopicDraft(payload.notebook.topic);
      setContentDraft(payload.notebook.content_md ?? "");
      setMessage("Notebook saved.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save notebook.");
    } finally {
      setIsSaving(false);
    }
  }

  const hasNotebooks = sortedNotebooks.length > 0;

  useEffect(() => {
    void loadNotebooks();
  }, []);

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
            Personal Notebook
          </p>
          <h2 className="mt-3 text-2xl font-extrabold text-[#1F2937]">Notes for {folderName}</h2>
          <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
            Keep your own notes and saved Study Room content here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setIsAddTopicOpen(true);
            setError("");
          }}
          className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 !text-sm"
        >
          Add Note
        </button>
      </div>

      {isAddTopicOpen ? (
        <div className="mt-4 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4">
          <label className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
            Note Topic
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={newTopic}
              onChange={(event) => setNewTopic(event.target.value)}
              placeholder="Example: React Room Summary"
              className="w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <button
              type="button"
              onClick={() => {
                void handleCreateNotebook();
              }}
              disabled={isCreating}
              className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCreating ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAddTopicOpen(false);
                setNewTopic("");
              }}
              className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
          {message}
        </p>
      ) : null}

      {isLoading ? (
        <p className="mt-5 text-sm font-semibold text-[#1F2937]/70">Loading notebooks...</p>
      ) : null}

      {!isLoading && !hasNotebooks ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-[#1F2937]/15 bg-[#F8FCFF] p-5">
          <p className="text-base font-extrabold text-[#1F2937]">No notes yet.</p>
          <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
            Click Add Note, enter a topic, and start writing your first notebook entry.
          </p>
        </div>
      ) : null}

      {!isLoading && hasNotebooks ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="max-h-[540px] overflow-y-auto rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-3">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
              Notebook List
            </p>
            <ol className="space-y-2">
              {sortedNotebooks.map((item) => {
                const isActive = selectedNotebookId === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedNotebookId(item.id);
                        setTopicDraft(item.topic);
                        setContentDraft(item.content_md ?? "");
                        setMessage("");
                      }}
                      className={`w-full rounded-xl border-2 px-3 py-2 text-left transition ${
                        isActive
                          ? "border-[#1F2937] bg-[#E9FFD8] shadow-[0_3px_0_#1F2937]"
                          : "border-[#1F2937]/12 bg-white hover:border-[#58CC02]/40"
                      }`}
                    >
                      <p className="truncate text-sm font-extrabold text-[#1F2937]">{item.topic}</p>
                      <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/62">
                        Updated: {formatTimestamp(item.updated_at)}
                      </p>
                      <p className="text-[11px] font-semibold text-[#1F2937]/52">
                        Created: {formatTimestamp(item.created_at)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
            {selectedNotebook ? (
              <>
                <label className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                  Topic
                </label>
                <input
                  value={topicDraft}
                  onChange={(event) => setTopicDraft(event.target.value)}
                  className="mt-2 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                />

                <label className="mt-4 block text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                  Content (Markdown)
                </label>
                <textarea
                  value={contentDraft}
                  onChange={(event) => setContentDraft(event.target.value)}
                  className="mt-2 min-h-[360px] w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                />

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveNotebook();
                    }}
                    disabled={isSaving}
                    className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSaving ? "Saving..." : "Save Notebook"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm font-semibold text-[#1F2937]/70">
                Select a note from the list to review and edit.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            void loadNotebooks();
          }}
          className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-4 !text-xs"
        >
          Refresh Notes
        </button>
      </div>
    </section>
  );
}
