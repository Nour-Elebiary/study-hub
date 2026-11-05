"use client";

/** A link card: domain + optional caption, opened in a new tab by the wrapper. */
export default function LinkCard({
  data,
}: {
  data: { card: { url: string | null; label: string | null } };
}) {
  const url = data.card.url ?? "";
  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch {
    domain = url;
  }
  return (
    <div className="flex items-center gap-2 p-3">
      <span aria-hidden="true">🔗</span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold" dir="auto">
          {data.card.label || domain}
        </span>
        <span className="text-muted-foreground block truncate text-[10px]">
          {domain}
        </span>
      </span>
    </div>
  );
}
