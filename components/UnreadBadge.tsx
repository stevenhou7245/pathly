"use client";

type UnreadBadgeProps = {
  count: number;
};

export default function UnreadBadge({ count }: UnreadBadgeProps) {
  if (count <= 0) {
    return null;
  }

  return (
    <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#E53935] px-1 text-[10px] font-extrabold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
