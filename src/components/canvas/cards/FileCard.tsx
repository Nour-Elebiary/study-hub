"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { FileTarget } from "../payload";

const KIND_ICONS: Record<string, string> = {
  image: "🖼️",
  pdf: "📄",
  audio: "🎧",
  video: "🎬",
  document: "📃",
  other: "📎",
};

const DEFAULT_ICON = "📎";

export type FileCardData = {
  card: { label: string | null };
  file?: FileTarget;
  /** Leaders sign image thumbnails in the browser; students get plain icons. */
  leader: boolean;
};

const formatSize = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * A file card (spec 5.6): kind icon, name, size. Image files get a thumbnail
 * through a signed URL requested lazily — only when the card scrolls into
 * view, and only in a leader session (students keep the lightweight sheet).
 */
export default function FileCard({ data }: { data: FileCardData }) {
  const file = data.file;
  const box = useRef<HTMLDivElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const name = data.card.label || file?.name || "File";
  const isImage = Boolean(file?.mime.startsWith("image/"));

  useEffect(() => {
    if (!isImage || !file || !data.leader || imageUrl || failed) return;
    const node = box.current;
    if (!node) return;
    let cancelled = false;
    const loader = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        loader.disconnect();
        createBrowserSupabase()
          .storage.from("assets")
          .createSignedUrl(file.pathOrUrl, 600)
          .then(({ data: signed }) => {
            if (cancelled) return;
            if (signed?.signedUrl) setImageUrl(signed.signedUrl);
            else setFailed(true);
          });
      },
      { rootMargin: "200px" },
    );
    loader.observe(node);
    return () => {
      cancelled = true;
      loader.disconnect();
    };
  }, [isImage, file, data.leader, imageUrl, failed]);

  if (!file) {
    return <div className="p-3 text-sm">Missing file content.</div>;
  }

  const icon = KIND_ICONS[file.kind] ?? DEFAULT_ICON;

  return (
    <div ref={box} className="p-2">
      {isImage && imageUrl ? (
        // Ten-minute signed link from the app's own storage bucket only
        // (spec 5.6: no external images).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="bg-muted mb-1 h-20 w-full rounded object-cover"
          loading="lazy"
        />
      ) : (
        <span
          className="bg-muted mb-1 flex h-16 w-full items-center justify-center rounded text-2xl"
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <p className="truncate text-xs font-semibold" dir="auto" title={name}>
        {name}
      </p>
      <p className="text-muted-foreground text-[10px]">
        {formatSize(file.bytes)}
        {isImage ? "" : ` · ${file.kind}`}
        {!file.visible && data.leader ? " · hidden from students" : ""}
      </p>
    </div>
  );
}
