"use client";

/** A text card: the leader's own words shown right on the map. */
export default function TextCard({
  data,
}: {
  data: { card: { body: string | null; label: string | null } };
}) {
  const body = data.card.body ?? data.card.label ?? "";
  return (
    <div className="p-3 text-sm leading-snug break-words" dir="auto">
      {body}
    </div>
  );
}
