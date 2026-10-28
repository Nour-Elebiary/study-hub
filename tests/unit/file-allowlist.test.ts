import { describe, expect, it } from "vitest";
import {
  extensionOf,
  kindForMime,
  mimeForFileName,
  randomStoragePath,
  sniffMime,
  validateUpload,
} from "@/lib/file-allowlist";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("extensionOf and mimeForFileName", () => {
  it("reads the last extension, case-insensitively", () => {
    expect(extensionOf("photo.JPG")).toBe("jpg");
    expect(mimeForFileName("photo.JPG")).toBe("image/jpeg");
    expect(mimeForFileName("notes.MD")).toBe("text/plain");
  });

  it("returns null for disallowed types — SVG and HTML included", () => {
    expect(mimeForFileName("drawing.svg")).toBeNull();
    expect(mimeForFileName("page.html")).toBeNull();
    expect(mimeForFileName("archive.exe")).toBeNull();
    expect(mimeForFileName("noextension")).toBeNull();
  });
});

describe("sniffMime", () => {
  it("detects common signatures", () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe("image/png");
    expect(sniffMime(text("%PDF-1.7 ......"))).toBe("application/pdf");
    expect(sniffMime(text("ID3\x04...."))).toBe("audio/mpeg");
    expect(sniffMime(bytes(0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("audio/ogg");
    expect(sniffMime(bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("video/webm");
  });

  it("tells WebP and WAV apart inside the RIFF container", () => {
    const riff = (form: string) => new Uint8Array([...text("RIFF...." + form)]);
    expect(sniffMime(riff("WEBP"))).toBe("image/webp");
    expect(sniffMime(riff("WAVE"))).toBe("audio/wav");
  });

  it("reports containers whose type depends on the extension", () => {
    const ftyp = new Uint8Array([...text("....ftypisom....")]);
    expect(sniffMime(ftyp)).toBe("mp4-container");
    expect(sniffMime(bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("zip-container");
    expect(sniffMime(bytes(0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0))).toBe("ole2");
  });

  it("returns null for unknown or too-short content", () => {
    expect(sniffMime(text("<svg xmlns='x'>"))).toBeNull();
    expect(sniffMime(bytes(0x00, 0x01))).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a real JPEG", () => {
    const result = validateUpload("photo.jpg", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(result).toEqual({ ok: true, mime: "image/jpeg", kind: "image" });
  });

  it("accepts a real PDF", () => {
    const result = validateUpload("handout.pdf", text("%PDF-1.7 ........"));
    expect(result).toEqual({ ok: true, mime: "application/pdf", kind: "pdf" });
  });

  it("accepts Office files by their zip signature", () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(validateUpload("notes.docx", zip)).toMatchObject({ ok: true, kind: "document" });
    expect(validateUpload("marks.xlsx", zip)).toMatchObject({ ok: true, kind: "document" });
    expect(validateUpload("slides.pptx", zip)).toMatchObject({ ok: true, kind: "document" });
  });

  it("accepts mp4 video and m4a audio by the ftyp container", () => {
    const ftyp = new Uint8Array([...text("....ftypisom....")]);
    expect(validateUpload("lesson.mp4", ftyp)).toMatchObject({ ok: true, kind: "video" });
    expect(validateUpload("recording.m4a", ftyp)).toMatchObject({ ok: true, kind: "audio" });
  });

  it("accepts plain text where no magic bytes exist", () => {
    expect(validateUpload("notes.txt", text("hello world"))).toMatchObject({
      ok: true,
      kind: "document",
    });
    expect(validateUpload("notes.md", text("# Notes"))).toMatchObject({ ok: true });
  });

  it("rejects disallowed extensions before reading anything", () => {
    const result = validateUpload("script.svg", text("<svg xmlns='x'>"));
    expect(result.ok).toBe(false);
    expect(validateUpload("page.html", text("<html>"))).toMatchObject({ ok: false });
  });

  it("rejects a file whose content disagrees with its extension", () => {
    // An HTML file renamed to .png must not pass.
    const result = validateUpload("evil.png", text("<html><script>alert(1)</script>"));
    expect(result.ok).toBe(false);
  });

  it("rejects legacy Office formats at the extension gate", () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0);
    const result = validateUpload("old.doc", ole);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not allowed");
  });
});

describe("kindForMime", () => {
  it("maps mimes to asset kinds", () => {
    expect(kindForMime("image/jpeg")).toBe("image");
    expect(kindForMime("application/pdf")).toBe("pdf");
    expect(kindForMime("audio/mpeg")).toBe("audio");
    expect(kindForMime("video/mp4")).toBe("video");
    expect(kindForMime("text/plain")).toBe("document");
    expect(kindForMime("application/octet-stream")).toBe("other");
  });
});

describe("randomStoragePath", () => {
  it("puts the file under the course id with a random name", () => {
    const path = randomStoragePath(
      "cccccccc-0000-cccc-0000-000000000001",
      "My Photo.jpg",
    );
    expect(path.startsWith("cccccccc-0000-cccc-0000-000000000001/")).toBe(true);
    expect(path.endsWith(".jpg")).toBe(true);
    // The user's file name never appears in the stored path.
    expect(path).not.toContain("My Photo");
  });

  it("keeps no extension when the name has none", () => {
    const path = randomStoragePath(
      "cccccccc-0000-cccc-0000-000000000001",
      "file",
    );
    expect(path).toBe("cccccccc-0000-cccc-0000-000000000001/" + path.split("/")[1]);
    expect(path.includes(".")).toBe(false);
  });

  it("generates a different name every time", () => {
    const a = randomStoragePath("cccccccc-0000-cccc-0000-000000000001", "a.pdf");
    const b = randomStoragePath("cccccccc-0000-cccc-0000-000000000001", "a.pdf");
    expect(a).not.toBe(b);
  });
});
