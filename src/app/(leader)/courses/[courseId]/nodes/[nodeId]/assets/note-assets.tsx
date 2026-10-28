"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  kindForMime,
  mimeForFileName,
  randomStoragePath,
  validateUpload,
} from "@/lib/file-allowlist";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  addLinkAssetAction,
  deleteAssetAction,
  registerUploadAction,
  replaceAssetAction,
  updateAssetAction,
} from "./actions";
import { PdfPreview } from "./pdf-preview";

export type AssetItem = {
  id: string;
  title: string;
  kind: "image" | "pdf" | "audio" | "video" | "document" | "other";
  storage: "supabase" | "drive" | "link";
  pathOrUrl: string;
  mime: string;
  sizeBytes: number | null;
  studentVisible: boolean;
  studentDownloadable: boolean;
};

const KIND_ICONS: Record<AssetItem["kind"], string> = {
  image: "🖼️",
  pdf: "📄",
  audio: "🎧",
  video: "🎬",
  document: "📝",
  other: "📎",
};

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formDataOf(values: Record<string, string | number | null>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    fd.set(key, value === null ? "" : String(value));
  }
  return fd;
}

function kindForUrl(url: string): AssetItem["kind"] {
  const path = url.split(/[?#]/)[0];
  const mime = mimeForFileName(path);
  return mime ? kindForMime(mime) : "document";
}

/**
 * The files attached to a note (spec section 6). Uploads come from the file
 * picker or the phone camera; anything over the size limit prompts for a
 * Drive or web link instead. Uploads go straight from the browser to
 * Supabase Storage — the heavy file never passes through the web server.
 */
export function NoteAssets({
  courseId,
  nodeId,
  assets,
  canManage,
  maxFileMb,
}: {
  courseId: string;
  nodeId: string;
  assets: AssetItem[];
  canManage: boolean;
  maxFileMb: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Upload inputs: one normal picker, one camera capture.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  // The over-size gate: prompt for a Drive or web link instead.
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  // Inline editing.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const maxBytes = maxFileMb * 1024 * 1024;

  async function signedUrlFor(
    pathOrUrl: string,
    title: string,
  ): Promise<string | null> {
    const supabase = createBrowserSupabase();
    const { data } = await supabase.storage
      .from("assets")
      .createSignedUrl(pathOrUrl, 600, { download: title || true });
    return data?.signedUrl ?? null;
  }

  async function handleFileChosen(file: File, replaceAssetId: string | null) {
    setError(null);
    setStatus(null);

    if (file.size > maxBytes) {
      // The 10 MB gate: a heavy file prompts for a link instead.
      setShowLinkForm(true);
      setLinkTitle(file.name.replace(/\.[^.]+$/, ""));
      setLinkUrl("");
      setStatus(
        `That file is ${formatSize(file.size)} — over the ${maxFileMb} MB limit. ` +
          "Put it on Google Drive and add the link below.",
      );
      return;
    }

    const check = validateUpload(
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    if (!check.ok) {
      setError(check.reason);
      return;
    }

    setBusy(true);
    try {
      const path = randomStoragePath(courseId, file.name);
      const supabase = createBrowserSupabase();
      const { error: uploadError } = await supabase.storage
        .from("assets")
        .upload(path, file, { contentType: check.mime });
      if (uploadError) {
        setError("The upload failed. Check your connection and try again.");
        return;
      }

      if (replaceAssetId) {
        const result = await replaceAssetAction(
          null,
          formDataOf({
            asset_id: replaceAssetId,
            storage: "supabase",
            path_or_url: path,
            mime: check.mime,
            size_bytes: file.size,
          }),
        );
        if (result && "error" in result && result.error) {
          setError(result.error);
          return;
        }
      } else {
        const result = await registerUploadAction(
          null,
          formDataOf({
            course_id: courseId,
            node_id: nodeId,
            kind: check.kind,
            path_or_url: path,
            title: file.name,
            mime: check.mime,
            size_bytes: file.size,
          }),
        );
        if (result && "error" in result && result.error) {
          setError(result.error);
          return;
        }
      }
      setStatus("File saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addLink() {
    setError(null);
    if (linkUrl.trim().length === 0) {
      setError("Paste the link first.");
      return;
    }
    setBusy(true);
    try {
      const url = linkUrl.trim();
      const result = await addLinkAssetAction(
        null,
        formDataOf({
          course_id: courseId,
          node_id: nodeId,
          kind: kindForUrl(url),
          storage: /drive\.google\.com|docs\.google\.com/.test(url)
            ? "drive"
            : "link",
          url,
          title: linkTitle.trim() || "Linked file",
        }),
      );
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setLinkTitle("");
      setLinkUrl("");
      setShowLinkForm(false);
      setStatus("Link added.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(asset: AssetItem) {
    setBusy(true);
    setError(null);
    try {
      const result = await updateAssetAction(
        null,
        formDataOf({ asset_id: asset.id, title: renameValue }),
      );
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      setRenamingId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleFlag(
    asset: AssetItem,
    flag: "student_visible" | "student_downloadable",
  ) {
    setBusy(true);
    setError(null);
    try {
      const current =
        flag === "student_visible"
          ? asset.studentVisible
          : asset.studentDownloadable;
      const result = await updateAssetAction(
        null,
        formDataOf({ asset_id: asset.id, [flag]: String(!current) }),
      );
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(asset: AssetItem) {
    if (!window.confirm(`Delete "${asset.title}"? This cannot be undone.`))
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAssetAction(
        null,
        formDataOf({ asset_id: asset.id }),
      );
      if (result && "error" in result && result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function togglePreview(asset: AssetItem) {
    setError(null);
    if (previewId === asset.id) {
      setPreviewId(null);
      setPreviewUrl(null);
      return;
    }
    if (asset.storage !== "supabase") return;
    setBusy(true);
    try {
      const url = await signedUrlFor(asset.pathOrUrl, asset.title);
      if (!url) {
        setError("The preview link could not be created.");
        return;
      }
      setPreviewId(asset.id);
      setPreviewUrl(url);
    } finally {
      setBusy(false);
    }
  }

  async function download(asset: AssetItem) {
    const url = await signedUrlFor(asset.pathOrUrl, asset.title);
    if (url) window.open(url, "_blank", "noopener");
  }

  return (
    <section className="grid gap-3" aria-label="Files attached to this note">
      <h2 className="text-lg font-semibold">Files</h2>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-muted-foreground text-sm">
          {status}
        </p>
      )}

      {assets.length === 0 && (
        <p className="text-muted-foreground text-sm">No files attached yet.</p>
      )}

      <ul className="grid gap-2">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className="grid gap-2 rounded-md border p-3 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden>{KIND_ICONS[asset.kind]}</span>
              <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
                {asset.title}
              </span>
              {asset.storage === "supabase" ? (
                <span className="text-muted-foreground text-xs">
                  {formatSize(asset.sizeBytes)}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">
                  {asset.storage === "drive" ? "on Drive" : "web link"}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {asset.storage === "supabase" && (
                <>
                  {(asset.kind === "pdf" ||
                    asset.kind === "image" ||
                    asset.kind === "audio" ||
                    asset.kind === "video") && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void togglePreview(asset)}
                    >
                      {previewId === asset.id ? "Hide preview" : "Preview"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void download(asset)}
                  >
                    Download
                  </Button>
                </>
              )}
              {asset.storage !== "supabase" && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={asset.pathOrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open link
                  </a>
                </Button>
              )}
              {canManage && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setRenamingId(asset.id);
                      setRenameValue(asset.title);
                    }}
                  >
                    Rename
                  </Button>
                  {asset.storage === "supabase" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setReplacingId(asset.id);
                        replaceInputRef.current?.click();
                      }}
                    >
                      Replace
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => void remove(asset)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>

            {renamingId === asset.id && (
              <div className="grid gap-2 rounded-md border p-2">
                <Label htmlFor={`rename-${asset.id}`}>File name</Label>
                <Input
                  id={`rename-${asset.id}`}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  maxLength={200}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void saveRename(asset)}
                  >
                    Save name
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRenamingId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={asset.studentVisible}
                    disabled={busy}
                    onChange={() => void toggleFlag(asset, "student_visible")}
                  />
                  Students can see it
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={asset.studentDownloadable}
                    disabled={busy}
                    onChange={() =>
                      void toggleFlag(asset, "student_downloadable")
                    }
                  />
                  Students can download it
                </label>
              </div>
            )}

            {previewId === asset.id && previewUrl && (
              <div className="grid gap-2">
                {asset.kind === "pdf" && (
                  <PdfPreview signedUrl={previewUrl} title={asset.title} />
                )}
                {asset.kind === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={`Preview of ${asset.title}`}
                    className="max-w-full rounded-md border"
                  />
                )}
                {asset.kind === "audio" && (
                  <audio controls src={previewUrl} className="w-full">
                    Your browser cannot play this audio.
                  </audio>
                )}
                {asset.kind === "video" && (
                  <video
                    controls
                    src={previewUrl}
                    className="w-full rounded-md border"
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="grid gap-2 rounded-md border p-3">
          <p className="font-medium">Add a file</p>
          <p className="text-muted-foreground text-xs">
            Up to {maxFileMb} MB per file. Bigger files go on Google Drive and
            are added as a link. Only upload files you trust.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose a file
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => cameraInputRef.current?.click()}
            >
              Take a photo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowLinkForm((s) => !s)}
            >
              {showLinkForm ? "Hide link form" : "Add a Drive or web link"}
            </Button>
          </div>

          {/* Hidden inputs: the visible buttons trigger these. */}
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFileChosen(file, null);
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFileChosen(file, null);
            }}
          />
          <input
            ref={replaceInputRef}
            type="file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              const id = replacingId;
              setReplacingId(null);
              if (file && id) void handleFileChosen(file, id);
            }}
          />

          {showLinkForm && (
            <div className="grid gap-2">
              <Label htmlFor="link_title">Title</Label>
              <Input
                id="link_title"
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                maxLength={200}
                placeholder="For example: Lecture slides (on Drive)"
              />
              <Label htmlFor="link_url">Link (https://…)</Label>
              <Input
                id="link_url"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://drive.google.com/file/d/…"
                dir="ltr"
              />
              <Button
                type="button"
                size="sm"
                className="w-fit"
                disabled={busy}
                onClick={() => void addLink()}
              >
                Save link
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
