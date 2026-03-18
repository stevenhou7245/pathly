type FriendListItem = {
  friendship_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  current_learning_field_title: string | null;
  is_online: boolean;
  last_seen_at: string | null;
};

type DirectMessageItem = {
  id: string;
  friendship_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string | null;
};

type FriendChatPanelProps = {
  currentUserId: string;
  friend: FriendListItem | null;
  messages: DirectMessageItem[];
  draftMessage: string;
  onDraftChange: (value: string) => void;
  onSendMessage: () => void;
  onOpenProfile: () => void;
  onStudyTogether: () => void;
  isSendingMessage: boolean;
  isSendingStudyInvitation: boolean;
};

function toInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "M";
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Now";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "Now";
  }
  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusText(friend: FriendListItem) {
  if (friend.is_online) {
    return "Online now";
  }
  if (!friend.last_seen_at) {
    return "Offline";
  }
  const timestamp = new Date(friend.last_seen_at);
  if (Number.isNaN(timestamp.getTime())) {
    return "Offline";
  }
  return `Last seen ${timestamp.toLocaleString()}`;
}

export default function FriendChatPanel({
  currentUserId,
  friend,
  messages,
  draftMessage,
  onDraftChange,
  onSendMessage,
  onOpenProfile,
  onStudyTogether,
  isSendingMessage,
  isSendingStudyInvitation,
}: FriendChatPanelProps) {
  if (!friend) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-3xl border-2 border-dashed border-[#1F2937]/20 bg-[#F7FCFF] p-6 text-center">
        <div>
          <p className="text-2xl font-extrabold text-[#1F2937]">No friends selected yet.</p>
          <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">
            Choose a friend to view real chat history.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-4 shadow-[0_5px_0_rgba(31,41,55,0.08)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#1F2937]/10 pb-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1F2937]/20 bg-[#FFD84D] text-sm font-extrabold text-[#1F2937]">
            {toInitial(friend.username)}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${
                friend.is_online ? "bg-[#58CC02]" : "bg-zinc-400"
              }`}
            />
          </div>
          <div>
            <p className="text-lg font-extrabold text-[#1F2937]">{friend.username}</p>
            <p className="text-sm font-semibold text-[#1F2937]/65">
              {friend.current_learning_field_title ?? "No active learning field"}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onOpenProfile}
            className="rounded-full border-2 border-[#1F2937]/15 bg-[#FFF9DD] px-4 py-2 text-sm font-bold text-[#1F2937] transition hover:border-[#FFD84D]/60"
          >
            View Profile
          </button>
          <button
            type="button"
            onClick={onStudyTogether}
            disabled={!friend.is_online || isSendingStudyInvitation}
            className="rounded-full border-2 border-[#1F2937]/15 bg-[#58CC02]/15 px-4 py-2 text-sm font-bold text-[#1F2937] transition hover:border-[#58CC02]/60 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSendingStudyInvitation ? "Sending..." : "Study Together"}
          </button>
        </div>
      </div>

      <p className="mt-3 rounded-xl bg-[#F6FCFF] px-3 py-2 text-sm font-semibold text-[#1F2937]/75">
        {getStatusText(friend)}
      </p>

      <div className="mt-4 flex h-60 flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-[#1F2937]/10 bg-[#F9FCFF] p-3">
        {messages.length === 0 ? (
          <div className="my-auto text-center text-sm font-semibold text-[#1F2937]/65">
            No messages yet. Start the conversation.
          </div>
        ) : (
          messages.map((message) => {
            const isMe = message.sender_id === currentUserId;
            return (
              <div
                key={message.id}
                className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm font-semibold ${
                  isMe
                    ? "ml-auto bg-[#58CC02] text-white"
                    : "mr-auto border-2 border-[#1F2937]/10 bg-white text-[#1F2937]"
                }`}
              >
                <p>{message.body}</p>
                <p className={`mt-1 text-[11px] ${isMe ? "text-white/80" : "text-[#1F2937]/55"}`}>
                  {formatTimestamp(message.created_at)}
                </p>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={draftMessage}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Send a friendly message..."
          className="w-full rounded-2xl border-2 border-[#1F2937]/15 bg-white px-4 py-3 text-base text-[#1F2937] shadow-[0_2px_0_rgba(31,41,55,0.08)] outline-none transition placeholder:text-[#1F2937]/35 focus:border-[#58CC02] focus:ring-2 focus:ring-[#58CC02]/20"
        />
        <button
          type="button"
          onClick={onSendMessage}
          disabled={isSendingMessage}
          className="btn-3d btn-3d-green inline-flex h-12 shrink-0 items-center justify-center px-6 !text-base disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSendingMessage ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

