/**
 * Upload allow-list and magic-byte checking (spec section 11 rule 4).
 *
 * The browser checks the file before uploading (a heavy file never reaches
 * the server), and the server action runs the same pure functions again.
 * This module is pure and shared by both sides — it holds no secrets.
 * SVG and HTML are never allowed — they can carry scripts.
 */

/** Allowed extensions mapped to the mime we store for them. */
export const ALLOWED_EXTENSIONS: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/plain",
};

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

export function mimeForFileName(fileName: string): string | null {
  return ALLOWED_EXTENSIONS[extensionOf(fileName)] ?? null;
}

/** Which asset row `kind` a mime maps to (the assets.kind column). */
export function kindForMime(
  mime: string,
): "image" | "pdf" | "audio" | "video" | "document" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/") || mime.startsWith("application/vnd.")) {
    return "document";
  }
  return "other";
}

/**
 * Reads the first bytes of a file and reports what it really is. Returns the
 * detected mime, a container name for formats whose exact type depends on the
 * extension ("mp4-container", "zip-container"), or null when nothing matches.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((b, i) => bytes[offset + i] === b);
  const asciiAt = (offset: number, text: string) =>
    [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));

  if (bytes.length < 4) return null;

  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12) {
    // RIFF container: WebP or WAV, told apart by the form type at offset 8.
    if (asciiAt(8, "WEBP")) return "image/webp";
    if (asciiAt(8, "WAVE")) return "audio/wav";
    return null;
  }
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith([0x49, 0x44, 0x33])) return "audio/mpeg"; // ID3 tag
  if (startsWith([0xff, 0xfb]) || startsWith([0xff, 0xf3])) return "audio/mpeg";
  if (startsWith([0x4f, 0x67, 0x67, 0x53])) return "audio/ogg"; // OggS
  if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return "video/webm"; // EBML
  if (bytes.length >= 8 && asciiAt(4, "ftyp")) return "mp4-container";
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) return "zip-container"; // PK..
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0])) return "ole2"; // legacy Office
  return null;
}

export type UploadCheck =
  | {
      ok: true;
      mime: string;
      kind: "image" | "pdf" | "audio" | "video" | "document" | "other";
    }
  | { ok: false; reason: string };

/**
 * The full check for one upload: extension allowed, and the file's first
 * bytes agree with the extension. Plain text has no magic bytes to check, so
 * the extension decides for txt/md.
 */
export function validateUpload(
  fileName: string,
  bytes: Uint8Array,
): UploadCheck {
  const mime = mimeForFileName(fileName);
  if (!mime) {
    return {
      ok: false,
      reason:
        "This file type is not allowed. Allowed: images, PDF, audio, video, Word, Excel, PowerPoint, text.",
    };
  }

  const sniffed = sniffMime(bytes);
  const ext = extensionOf(fileName);

  if (sniffed === null) {
    if (mime.startsWith("text/")) {
      return { ok: true, mime, kind: kindForMime(mime) };
    }
    return {
      ok: false,
      reason:
        "This file does not look like a real " + ext.toUpperCase() + " file.",
    };
  }

  if (sniffed === "ole2") {
    return {
      ok: false,
      reason:
        "This is an old Office file. Save it as .docx, .xlsx or .pptx and try again.",
    };
  }

  if (sniffed === "zip-container") {
    if (mime.startsWith("application/vnd.")) {
      return { ok: true, mime, kind: kindForMime(mime) };
    }
    return {
      ok: false,
      reason:
        "This file does not look like a real " + ext.toUpperCase() + " file.",
    };
  }

  if (sniffed === "mp4-container") {
    if (ext === "mp4" || ext === "m4a") {
      return { ok: true, mime, kind: kindForMime(mime) };
    }
    return {
      ok: false,
      reason:
        "This file does not look like a real " + ext.toUpperCase() + " file.",
    };
  }

  if (sniffed !== mime) {
    return {
      ok: false,
      reason:
        "This file does not look like a real " + ext.toUpperCase() + " file.",
    };
  }

  return { ok: true, mime, kind: kindForMime(mime) };
}

/**
 * The storage path for an upload: "{course_id}/{random-name}" (spec section
 * 11 rule 4 — files are stored under random names, never the user's name).
 * The extension is kept so previews and downloads still work.
 */
export function randomStoragePath(courseId: string, fileName: string): string {
  const ext = extensionOf(fileName);
  const random = crypto.randomUUID().replaceAll("-", "");
  return `${courseId}/${random}${ext ? "." + ext : ""}`;
}
