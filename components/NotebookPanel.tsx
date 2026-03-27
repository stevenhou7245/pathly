"use client";

import { useEffect, useMemo, useState } from "react";

const NOTEBOOKS_INITIAL_VISIBLE_COUNT = 24;
const NOTEBOOKS_VISIBLE_STEP = 24;

type NotebookRecord = {
  id: string;
  user_id: string;
  name: string;
  created_at: string | null;
  updated_at: string | null;
  is_deleted: boolean;
};

type NotebookEntryRecord = {
  id: string;
  notebook_id: string;
  topic: string;
  content_md: string | null;
  source_type: "manual" | "study_room_selection";
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

type NotebookEntriesResponse = {
  success: boolean;
  message?: string;
  notebook?: NotebookRecord;
  entries?: NotebookEntryRecord[];
  entry?: NotebookEntryRecord;
};

type NotebookEntryUpdateResponse = {
  success: boolean;
  message?: string;
  entry?: NotebookEntryRecord;
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
    return a.name.localeCompare(b.name);
  });
}

function sortEntries(items: NotebookEntryRecord[]) {
  return [...items].sort((a, b) => {
    const updatedCompare = (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
    if (updatedCompare !== 0) {
      return updatedCompare;
    }
    return a.topic.localeCompare(b.topic);
  });
}

export default function NotebookPanel() {
  const [notebooks, setNotebooks] = useState<NotebookRecord[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState("");
  const [selectedNotebookNameDraft, setSelectedNotebookNameDraft] = useState("");

  const [entries, setEntries] = useState<NotebookEntryRecord[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [selectedEntryTopicDraft, setSelectedEntryTopicDraft] = useState("");
  const [selectedEntryContentDraft, setSelectedEntryContentDraft] = useState("");
  const [isEntryDetailOpen, setIsEntryDetailOpen] = useState(false);

  const [isLoadingNotebooks, setIsLoadingNotebooks] = useState(true);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isCreatingNotebook, setIsCreatingNotebook] = useState(false);
  const [isSavingNotebookName, setIsSavingNotebookName] = useState(false);
  const [isCreatingEntry, setIsCreatingEntry] = useState(false);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [isDeletingNotebook, setIsDeletingNotebook] = useState(false);
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);

  const [newNotebookName, setNewNotebookName] = useState("");
  const [newEntryTopic, setNewEntryTopic] = useState("");
  const [newEntryContent, setNewEntryContent] = useState("");

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notebookToDelete, setNotebookToDelete] = useState<NotebookRecord | null>(null);
  const [entryToDelete, setEntryToDelete] = useState<NotebookEntryRecord | null>(null);
  const [visibleNotebookCount, setVisibleNotebookCount] = useState(NOTEBOOKS_INITIAL_VISIBLE_COUNT);
  const [visibleEntryCount, setVisibleEntryCount] = useState(NOTEBOOKS_INITIAL_VISIBLE_COUNT);

  const sortedNotebooks = useMemo(() => sortNotebooks(notebooks), [notebooks]);
  const sortedEntries = useMemo(() => sortEntries(entries), [entries]);
  const selectedNotebook = useMemo(
    () => sortedNotebooks.find((item) => item.id === selectedNotebookId) ?? null,
    [selectedNotebookId, sortedNotebooks],
  );
  const visibleNotebooks = useMemo(
    () => sortedNotebooks.slice(0, visibleNotebookCount),
    [sortedNotebooks, visibleNotebookCount],
  );
  const visibleEntries = useMemo(
    () => sortedEntries.slice(0, visibleEntryCount),
    [sortedEntries, visibleEntryCount],
  );
  const selectedEntry = useMemo(
    () => sortedEntries.find((item) => item.id === selectedEntryId) ?? null,
    [selectedEntryId, sortedEntries],
  );

  async function loadNotebooks() {
    setIsLoadingNotebooks(true);
    setError("");
    try {
      const response = await fetch("/api/notebooks?limit=120", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as NotebooksResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load notebooks.");
      }
      const rows = sortNotebooks(payload.notebooks ?? []);
      setNotebooks(rows);
      setVisibleNotebookCount(NOTEBOOKS_INITIAL_VISIBLE_COUNT);

      const nextNotebook = rows.find((row) => row.id === selectedNotebookId) ?? rows[0] ?? null;
      setSelectedNotebookId(nextNotebook?.id ?? "");
      setSelectedNotebookNameDraft(nextNotebook?.name ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load notebooks.");
      setNotebooks([]);
      setSelectedNotebookId("");
      setSelectedNotebookNameDraft("");
      setVisibleNotebookCount(NOTEBOOKS_INITIAL_VISIBLE_COUNT);
    } finally {
      setIsLoadingNotebooks(false);
    }
  }

  async function loadNotebookEntries(notebookId: string) {
    if (!notebookId) {
      setEntries([]);
      setSelectedEntryId("");
      setSelectedEntryTopicDraft("");
      setSelectedEntryContentDraft("");
      return;
    }
    setIsLoadingEntries(true);
    setError("");
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/entries?limit=180`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as NotebookEntriesResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load notebook entries.");
      }
      const rows = sortEntries(payload.entries ?? []);
      setEntries(rows);
      setVisibleEntryCount(NOTEBOOKS_INITIAL_VISIBLE_COUNT);

      const nextEntry = rows.find((row) => row.id === selectedEntryId) ?? rows[0] ?? null;
      setSelectedEntryId(nextEntry?.id ?? "");
      setSelectedEntryTopicDraft(nextEntry?.topic ?? "");
      setSelectedEntryContentDraft(nextEntry?.content_md ?? "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load notebook entries.");
      setEntries([]);
      setSelectedEntryId("");
      setSelectedEntryTopicDraft("");
      setSelectedEntryContentDraft("");
      setVisibleEntryCount(NOTEBOOKS_INITIAL_VISIBLE_COUNT);
    } finally {
      setIsLoadingEntries(false);
    }
  }

  async function handleCreateNotebook() {
    const normalizedName = newNotebookName.trim();
    if (!normalizedName) {
      setError("Please enter a notebook name.");
      return;
    }
    setIsCreatingNotebook(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/notebooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: normalizedName,
        }),
      });
      const payload = (await response.json()) as NotebooksResponse;
      if (!response.ok || !payload.success || !payload.notebook) {
        throw new Error(payload.message ?? "Unable to create notebook.");
      }

      const nextNotebooks = sortNotebooks([payload.notebook, ...notebooks]);
      setNotebooks(nextNotebooks);
      setSelectedNotebookId(payload.notebook.id);
      setSelectedNotebookNameDraft(payload.notebook.name);
      setNewNotebookName("");
      setMessage("Notebook created.");
      await loadNotebookEntries(payload.notebook.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create notebook.");
    } finally {
      setIsCreatingNotebook(false);
    }
  }

  async function handleSaveNotebookName() {
    if (!selectedNotebook) {
      return;
    }
    const normalizedName = selectedNotebookNameDraft.trim();
    if (!normalizedName) {
      setError("Notebook name cannot be empty.");
      return;
    }

    setIsSavingNotebookName(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(selectedNotebook.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: normalizedName,
        }),
      });
      const payload = (await response.json()) as NotebooksResponse;
      if (!response.ok || !payload.success || !payload.notebook) {
        throw new Error(payload.message ?? "Unable to update notebook name.");
      }
      setNotebooks((previous) =>
        sortNotebooks(previous.map((item) => (item.id === payload.notebook?.id ? payload.notebook : item))),
      );
      setSelectedNotebookNameDraft(payload.notebook.name);
      setMessage("Notebook name updated.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update notebook name.");
    } finally {
      setIsSavingNotebookName(false);
    }
  }

  async function handleCreateEntry() {
    if (!selectedNotebook) {
      setError("Choose a notebook first.");
      return;
    }
    const normalizedTopic = newEntryTopic.trim();
    if (!normalizedTopic) {
      setError("Please enter an entry topic.");
      return;
    }
    setIsCreatingEntry(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/notebooks/${encodeURIComponent(selectedNotebook.id)}/entries`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            topic: normalizedTopic,
            content_md: newEntryContent,
            source_type: "manual",
          }),
        },
      );
      const payload = (await response.json()) as NotebookEntriesResponse;
      if (!response.ok || !payload.success || !payload.entry) {
        throw new Error(payload.message ?? "Unable to create notebook entry.");
      }
      const nextEntries = sortEntries([payload.entry, ...entries]);
      setEntries(nextEntries);
      setSelectedEntryId(payload.entry.id);
      setSelectedEntryTopicDraft(payload.entry.topic);
      setSelectedEntryContentDraft(payload.entry.content_md ?? "");
      setNewEntryTopic("");
      setNewEntryContent("");
      setMessage("Notebook entry created.");
      await loadNotebooks();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create notebook entry.");
    } finally {
      setIsCreatingEntry(false);
    }
  }

  async function handleSaveEntry() {
    if (!selectedEntry) {
      return;
    }
    const normalizedTopic = selectedEntryTopicDraft.trim();
    if (!normalizedTopic) {
      setError("Entry topic cannot be empty.");
      return;
    }
    setIsSavingEntry(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/notebooks/entries/${encodeURIComponent(selectedEntry.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: normalizedTopic,
          content_md: selectedEntryContentDraft,
        }),
      });
      const payload = (await response.json()) as NotebookEntryUpdateResponse;
      if (!response.ok || !payload.success || !payload.entry) {
        throw new Error(payload.message ?? "Unable to save notebook entry.");
      }
      setEntries((previous) =>
        sortEntries(previous.map((entry) => (entry.id === payload.entry?.id ? payload.entry : entry))),
      );
      setSelectedEntryTopicDraft(payload.entry.topic);
      setSelectedEntryContentDraft(payload.entry.content_md ?? "");
      setMessage("Notebook entry saved.");
      await loadNotebooks();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save notebook entry.");
    } finally {
      setIsSavingEntry(false);
    }
  }

  async function handleDeleteNotebookConfirmed() {
    if (!notebookToDelete) {
      return;
    }
    setIsDeletingNotebook(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookToDelete.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as NotebooksResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to delete notebook.");
      }

      const deletedNotebookId = notebookToDelete.id;
      const remainingNotebooks = sortNotebooks(
        notebooks.filter((notebook) => notebook.id !== deletedNotebookId),
      );
      setNotebooks(remainingNotebooks);

      const hasCurrentSelection = remainingNotebooks.some(
        (notebook) => notebook.id === selectedNotebookId,
      );
      const nextNotebook =
        hasCurrentSelection && selectedNotebookId !== deletedNotebookId
          ? remainingNotebooks.find((notebook) => notebook.id === selectedNotebookId) ?? null
          : remainingNotebooks[0] ?? null;
      setSelectedNotebookId(nextNotebook?.id ?? "");
      setSelectedNotebookNameDraft(nextNotebook?.name ?? "");

      if (!nextNotebook) {
        setEntries([]);
        setSelectedEntryId("");
        setSelectedEntryTopicDraft("");
        setSelectedEntryContentDraft("");
        setIsEntryDetailOpen(false);
      } else if (nextNotebook.id !== selectedNotebookId || selectedNotebookId === deletedNotebookId) {
        await loadNotebookEntries(nextNotebook.id);
      }

      setNotebookToDelete(null);
      setMessage("Notebook deleted.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to delete notebook.");
    } finally {
      setIsDeletingNotebook(false);
    }
  }

  async function handleDeleteEntryConfirmed() {
    if (!entryToDelete) {
      return;
    }
    setIsDeletingEntry(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/notebooks/entries/${encodeURIComponent(entryToDelete.id)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json()) as NotebookEntryUpdateResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to delete notebook entry.");
      }

      const deletedEntryId = entryToDelete.id;
      const remainingEntries = sortEntries(entries.filter((entry) => entry.id !== deletedEntryId));
      setEntries(remainingEntries);

      if (selectedEntryId === deletedEntryId) {
        const nextEntry = remainingEntries[0] ?? null;
        setSelectedEntryId(nextEntry?.id ?? "");
        setSelectedEntryTopicDraft(nextEntry?.topic ?? "");
        setSelectedEntryContentDraft(nextEntry?.content_md ?? "");
        setIsEntryDetailOpen(false);
      }

      setEntryToDelete(null);
      setMessage("Notebook entry deleted.");
      await loadNotebooks();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to delete notebook entry.");
    } finally {
      setIsDeletingEntry(false);
    }
  }

  useEffect(() => {
    void loadNotebooks();
  }, []);

  useEffect(() => {
    if (!selectedNotebookId) {
      setEntries([]);
      setSelectedEntryId("");
      setSelectedEntryTopicDraft("");
      setSelectedEntryContentDraft("");
      setIsEntryDetailOpen(false);
      return;
    }
    setVisibleEntryCount(NOTEBOOKS_INITIAL_VISIBLE_COUNT);
    void loadNotebookEntries(selectedNotebookId);
  }, [selectedNotebookId]);

  useEffect(() => {
    if (!selectedEntry && isEntryDetailOpen) {
      setIsEntryDetailOpen(false);
    }
  }, [isEntryDetailOpen, selectedEntry]);

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-6 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="inline-flex rounded-full border-2 border-[#1F2937]/15 bg-[#FFF7CF] px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/75">
            Personal Notes
          </p>
          <h2 className="mt-3 text-2xl font-extrabold text-[#1F2937]">My Notebooks</h2>
          <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
            Create your own notebooks, then add entries with topic and content.
          </p>
        </div>
      </div>

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

      <div className="mt-5 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-3">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
            Notebook List
          </p>

          <div className="mt-2 flex flex-col gap-2">
            <input
              value={newNotebookName}
              onChange={(event) => setNewNotebookName(event.target.value)}
              placeholder="New notebook name"
              className="w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <button
              type="button"
              onClick={() => {
                void handleCreateNotebook();
              }}
              disabled={isCreatingNotebook}
              className="btn-3d btn-3d-green inline-flex h-9 items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCreatingNotebook ? "Creating..." : "Add Notebook"}
            </button>
          </div>

          {isLoadingNotebooks ? (
            <div className="mt-3 space-y-2">
              <div className="skeleton-block h-14 rounded-xl" />
              <div className="skeleton-block h-14 rounded-xl" />
              <div className="skeleton-block h-14 rounded-xl" />
            </div>
          ) : sortedNotebooks.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-[#1F2937]/70">No notebooks yet.</p>
          ) : (
            <ol className="mt-3 max-h-[420px] space-y-2 overflow-y-auto">
              {visibleNotebooks.map((notebook) => {
                const isActive = notebook.id === selectedNotebookId;
                const isDeletingThisNotebook =
                  isDeletingNotebook && notebookToDelete?.id === notebook.id;
                return (
                  <li key={notebook.id} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedNotebookId(notebook.id);
                        setSelectedNotebookNameDraft(notebook.name);
                        setMessage("");
                      }}
                      className={`w-full rounded-xl border-2 px-3 py-2 pr-10 text-left transition ${
                        isActive
                          ? "border-[#1F2937] bg-[#E9FFD8] shadow-[0_3px_0_#1F2937]"
                          : "border-[#1F2937]/12 bg-white hover:border-[#58CC02]/40"
                      }`}
                    >
                      <p className="truncate text-sm font-extrabold text-[#1F2937]">{notebook.name}</p>
                      <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/62">
                        Updated: {formatTimestamp(notebook.updated_at)}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${notebook.name}`}
                      disabled={isDeletingThisNotebook}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setNotebookToDelete(notebook);
                        setMessage("");
                      }}
                      className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#1F2937]/20 bg-white/95 text-xs font-extrabold text-[#1F2937]/70 transition hover:border-[#c62828]/40 hover:bg-[#ffeaea] hover:text-[#c62828] disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      X
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {!isLoadingNotebooks && sortedNotebooks.length > visibleNotebooks.length ? (
            <div className="mt-2 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setVisibleNotebookCount((previous) => previous + NOTEBOOKS_VISIBLE_STEP);
                }}
                className="rounded-full border border-[#1F2937]/20 bg-white px-4 py-1 text-xs font-extrabold text-[#1F2937]"
              >
                Load more notebooks ({sortedNotebooks.length - visibleNotebooks.length} hidden)
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
          {!selectedNotebook ? (
            <p className="text-sm font-semibold text-[#1F2937]/70">
              Select a notebook to manage its entries.
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                  Notebook Name
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={selectedNotebookNameDraft}
                    onChange={(event) => setSelectedNotebookNameDraft(event.target.value)}
                    className="w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleSaveNotebookName();
                    }}
                    disabled={isSavingNotebookName}
                    className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSavingNotebookName ? "Saving..." : "Rename"}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                  Add Entry
                </p>
                <input
                  value={newEntryTopic}
                  onChange={(event) => setNewEntryTopic(event.target.value)}
                  placeholder="Entry topic"
                  className="mt-2 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                />
                <textarea
                  value={newEntryContent}
                  onChange={(event) => setNewEntryContent(event.target.value)}
                  placeholder="Entry content"
                  className="mt-2 min-h-[120px] w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleCreateEntry();
                  }}
                  disabled={isCreatingEntry}
                  className="btn-3d btn-3d-green mt-2 inline-flex h-9 items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isCreatingEntry ? "Creating..." : "Add Entry"}
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-[#1F2937]/12 bg-white p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                  Entry List
                </p>
                {isLoadingEntries ? (
                  <div className="mt-2 space-y-2">
                    <div className="skeleton-block h-14 rounded-xl" />
                    <div className="skeleton-block h-14 rounded-xl" />
                    <div className="skeleton-block h-14 rounded-xl" />
                  </div>
                ) : sortedEntries.length === 0 ? (
                  <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">No entries yet.</p>
                ) : (
                  <ol className="mt-2 max-h-[420px] space-y-2 overflow-y-auto">
                    {visibleEntries.map((entry) => {
                      const isActive = entry.id === selectedEntryId;
                      const isDeletingThisEntry = isDeletingEntry && entryToDelete?.id === entry.id;
                      return (
                        <li key={entry.id} className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEntryId(entry.id);
                              setSelectedEntryTopicDraft(entry.topic);
                              setSelectedEntryContentDraft(entry.content_md ?? "");
                              setIsEntryDetailOpen(true);
                              setMessage("");
                            }}
                            className={`w-full rounded-lg border px-3 py-2 pr-10 text-left transition ${
                              isActive
                                ? "border-[#1F2937] bg-[#E9FFD8]"
                                : "border-[#1F2937]/12 bg-white hover:border-[#58CC02]/40"
                            }`}
                          >
                            <p className="truncate text-sm font-extrabold text-[#1F2937]">{entry.topic}</p>
                            <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/60">
                              Updated: {formatTimestamp(entry.updated_at)}
                            </p>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${entry.topic}`}
                            disabled={isDeletingThisEntry}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setEntryToDelete(entry);
                              setMessage("");
                            }}
                            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#1F2937]/20 bg-white/95 text-xs font-extrabold text-[#1F2937]/70 transition hover:border-[#c62828]/40 hover:bg-[#ffeaea] hover:text-[#c62828] disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            X
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {!isLoadingEntries && sortedEntries.length > visibleEntries.length ? (
                  <div className="mt-2 flex justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setVisibleEntryCount((previous) => previous + NOTEBOOKS_VISIBLE_STEP);
                      }}
                      className="rounded-full border border-[#1F2937]/20 bg-white px-4 py-1 text-xs font-extrabold text-[#1F2937]"
                    >
                      Load more entries ({sortedEntries.length - visibleEntries.length} hidden)
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {isEntryDetailOpen && selectedEntry ? (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-3xl rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] sm:p-6 motion-modal-content">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                  Entry Detail
                </p>
                <p className="mt-1 text-sm font-semibold text-[#1F2937]/70">
                  Read and edit this entry in a full-size view.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEntryDetailOpen(false)}
                className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-3 !text-xs"
              >
                Close
              </button>
            </div>

            <label className="mt-4 block text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
              Entry Topic
            </label>
            <input
              value={selectedEntryTopicDraft}
              onChange={(event) => setSelectedEntryTopicDraft(event.target.value)}
              className="mt-2 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />

            <label className="mt-3 block text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
              Entry Content (Markdown)
            </label>
            <textarea
              value={selectedEntryContentDraft}
              onChange={(event) => setSelectedEntryContentDraft(event.target.value)}
              className="mt-2 min-h-[360px] w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[#1F2937]/60">
              <p>Source: {selectedEntry.source_type}</p>
              <p>Updated: {formatTimestamp(selectedEntry.updated_at)}</p>
              <p>Created: {formatTimestamp(selectedEntry.created_at)}</p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEntryDetailOpen(false)}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSaveEntry();
                }}
                disabled={isSavingEntry}
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingEntry ? "Saving..." : "Save Entry"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {notebookToDelete ? (
        <div className="fixed inset-0 z-[83] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-md rounded-[1.8rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] motion-modal-content">
            <p className="text-xl font-extrabold text-[#1F2937]">Delete this notebook?</p>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
              This will remove notebook <span className="font-extrabold">"{notebookToDelete.name}"</span> and
              its related entries.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNotebookToDelete(null)}
                disabled={isDeletingNotebook}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteNotebookConfirmed();
                }}
                disabled={isDeletingNotebook}
                className="btn-3d inline-flex h-10 items-center justify-center border-[#A22020] bg-[#E53935] px-4 !text-sm text-white shadow-[0_4px_0_#7f1d1d] transition hover:-translate-y-0.5 hover:bg-[#d93431] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isDeletingNotebook ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {entryToDelete ? (
        <div className="fixed inset-0 z-[84] flex items-center justify-center bg-black/35 px-4 motion-modal-overlay">
          <div className="w-full max-w-md rounded-[1.8rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_10px_0_#1F2937,0_24px_34px_rgba(31,41,55,0.16)] motion-modal-content">
            <p className="text-xl font-extrabold text-[#1F2937]">Delete this entry?</p>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
              This will remove entry <span className="font-extrabold">"{entryToDelete.topic}"</span> only.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEntryToDelete(null)}
                disabled={isDeletingEntry}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteEntryConfirmed();
                }}
                disabled={isDeletingEntry}
                className="btn-3d inline-flex h-10 items-center justify-center border-[#A22020] bg-[#E53935] px-4 !text-sm text-white shadow-[0_4px_0_#7f1d1d] transition hover:-translate-y-0.5 hover:bg-[#d93431] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isDeletingEntry ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
