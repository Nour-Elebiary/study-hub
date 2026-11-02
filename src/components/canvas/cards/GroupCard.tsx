"use client";

/**
 * A group card: a labelled frame behind other cards (spec 5.6). It has no
 * React Flow `parentId` (D4) — children just sit inside its rectangle, and
 * cards sit ABOVE the group rectangle (`zIndex`), visually, so the group's
 * interior is never covering content.
 */
export default function GroupCard({
  data,
}: {
  data: { card: { label: string | null; body: string | null } };
}) {
  const label = data.card.label || data.card.body || "Group";
  return (
    <div className="h-full rounded-lg p-2 text-right">
      <span
        className="bg-background/90 inline-block max-w-full truncate rounded px-1.5 py-0.5 text-xs font-semibold"
        dir="auto"
      >
        {label}
      </span>
    </div>
  );
}
