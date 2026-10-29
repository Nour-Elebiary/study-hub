import { z } from "zod";

/**
 * The jobs queue (spec sections 5 and 7). Pure constants and schemas shared
 * by the server actions, the job screen and the browser runners — no
 * secrets and no server-only imports, so client code can import it too.
 */

export const JOB_TYPES = ["ocr", "convert", "transcribe", "ai_task"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "waiting_quota",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_RUNNERS = ["browser", "worker", "gemini"] as const;
export type JobRunner = (typeof JOB_RUNNERS)[number];

/** Retry policy (spec section 7 rule 1): up to 3 tries, growing delay. */
export const MAX_JOB_ATTEMPTS = 3;

/** Delay before retry N (1-based): 5s, then 15s, then 45s. */
export function retryDelaySeconds(attempt: number): number {
  return 5 * 3 ** (Math.max(1, attempt) - 1);
}

/** OCR languages (spec section 7 rule 4): the leader picks, never auto-detect. */
export const ocrLanguagesSchema = z
  .array(z.enum(["eng", "ara"]))
  .min(1, "Pick at least one language.");

export type OcrLanguage = "eng" | "ara";

export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  eng: "English",
  ara: "Arabic",
};

/** The .docx mime (Word to Markdown eligibility, spec section 7 table). */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** The .xlsx mime (Excel to CSV eligibility, spec section 7 table). */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Params per job type, validated before the row is written. The jobs.type
 * enum (spec section 5) has only four values, so the PDF tools are
 * "convert" jobs whose params say which tool runs.
 */
export const convertTools = [
  "word_to_markdown",
  "excel_to_csv",
  "pdf_merge",
  "pdf_split",
  "office_to_pdf",
  "video_to_audio",
  "compress_video",
] as const;
export type ConvertTool = (typeof convertTools)[number];

export const CONVERT_TOOL_LABELS: Record<ConvertTool, string> = {
  word_to_markdown: "Word to Markdown",
  excel_to_csv: "Excel to CSV",
  pdf_merge: "Merge PDFs",
  pdf_split: "Split a PDF",
  office_to_pdf: "Word or PowerPoint to PDF",
  video_to_audio: "Video to audio (MP3)",
  compress_video: "Compress a video",
};

/** Where OCR reads from: a photo (browser) or a scanned PDF (Home Worker). */
export const ocrSources = ["image", "pdf_scan"] as const;
export type OcrSource = (typeof ocrSources)[number];

/** The .pptx mime (office_to_pdf eligibility). */
export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const jobParamsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ocr"),
    languages: ocrLanguagesSchema,
    source: z.enum(ocrSources).default("image"),
  }),
  z.object({
    type: z.literal("convert"),
    tool: z.enum(convertTools),
    /** pdf_merge: the assets to combine, in order. */
    asset_ids: z.array(z.uuid()).min(2).max(10).optional(),
    /** pdf_split: pages to keep, e.g. "1-3,5". */
    pages: z
      .string()
      .regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/, "Use page numbers like 1-3,5.")
      .optional(),
  }),
  z.object({
    type: z.literal("transcribe"),
    languages: ocrLanguagesSchema,
  }),
  // ai_task arrives with M7; its params are defined then.
]);

export type JobParams = z.infer<typeof jobParamsSchema>;

/**
 * Which runner executes a job (spec section 7 table): light work in the
 * leader's browser, heavy work on the Home Worker. The server derives this
 * from the type and params — the leader never picks it by hand.
 */
export function runnerForJob(type: JobType, params: JobParams): JobRunner {
  if (type === "ocr") {
    return params.type === "ocr" && params.source === "pdf_scan"
      ? "worker"
      : "browser";
  }
  if (type === "transcribe") return "worker";
  if (type === "ai_task") return "gemini";
  // convert
  if (params.type !== "convert") return "browser";
  return params.tool === "word_to_markdown" ||
    params.tool === "excel_to_csv" ||
    params.tool === "pdf_merge" ||
    params.tool === "pdf_split"
    ? "browser"
    : "worker";
}

/**
 * The note title, note body and result-file name for a finished job (spec
 * section 7 rule 2). Shared by the browser completion action and the worker
 * complete endpoint so both file results identically. `text` is the
 * extracted text for text jobs; binary jobs get a description body.
 */
export function jobResultNaming(
  type: JobType,
  params: JobParams,
  sourceTitle: string,
  text?: string,
): { title: string; body: string; resultTitle: string; binary: boolean } {
  if (params.type === "convert") {
    const tool = params.tool;
    if (tool === "pdf_merge" || tool === "pdf_split") {
      return {
        title:
          tool === "pdf_merge"
            ? `Merged PDF — ${sourceTitle}`
            : `Split PDF — ${sourceTitle}`,
        body:
          tool === "pdf_merge"
            ? `A combined PDF made from ${
                params.asset_ids?.length ?? 0
              } files. Review it, then publish or delete this note.`
            : `Pages ${params.pages ?? ""} of ${sourceTitle}, saved as a new PDF. Review it, then publish or delete this note.`,
        resultTitle:
          tool === "pdf_merge"
            ? `${sourceTitle} (merged).pdf`
            : `${sourceTitle} (split).pdf`,
        binary: true,
      };
    }
    if (tool === "office_to_pdf") {
      return {
        title: `PDF copy — ${sourceTitle}`,
        body: `*Source file: ${sourceTitle}.* A PDF copy made from the document. Review it, then publish or delete this note.`,
        resultTitle: `${sourceTitle} (copy).pdf`,
        binary: true,
      };
    }
    if (tool === "video_to_audio") {
      return {
        title: `Audio — ${sourceTitle}`,
        body: `*Source file: ${sourceTitle}.* The sound from the video, saved as an MP3. Review it, then publish or delete this note.`,
        resultTitle: `${sourceTitle} (audio).mp3`,
        binary: true,
      };
    }
    if (tool === "compress_video") {
      return {
        title: `Compressed video — ${sourceTitle}`,
        body: `*Source file: ${sourceTitle}.* A smaller copy of the video. Review it, then publish or delete this note.`,
        resultTitle: `${sourceTitle} (small).mp4`,
        binary: true,
      };
    }
    if (tool === "excel_to_csv") {
      return {
        title: `${CONVERT_TOOL_LABELS[tool]} — ${sourceTitle}`,
        body: `*Source file: ${sourceTitle}.* The first sheet of the spreadsheet, saved as CSV. Review it, then publish or delete this note.`,
        resultTitle: `${sourceTitle} (table).csv`,
        binary: false,
      };
    }
    // word_to_markdown: a text result.
    return {
      title: `${CONVERT_TOOL_LABELS[tool]} — ${sourceTitle}`,
      body: `*Source file: ${sourceTitle}.*\n\n${text ?? ""}`,
      resultTitle: `${sourceTitle} (text).md`,
      binary: false,
    };
  }
  if (params.type === "ocr" && params.source === "pdf_scan") {
    return {
      title: `Scanned PDF (searchable) — ${sourceTitle}`,
      body: `*Source file: ${sourceTitle}.* A searchable copy of the scanned PDF with the text added as an invisible layer. Review it, then publish or delete this note.`,
      resultTitle: `${sourceTitle} (searchable).pdf`,
      binary: true,
    };
  }
  // Text jobs: image OCR and transcription.
  return {
    title: `${JOB_TYPE_LABELS[type]} — ${sourceTitle}`,
    body: `*Source file: ${sourceTitle}.*\n\n${text ?? ""}`,
    resultTitle: `${sourceTitle} (text).md`,
    binary: false,
  };
}

/**
 * Which files each tool can work on (spec section 7 table). Used by the job
 * form to hide ineligible files and re-checked by the server action. The
 * tool names are the job form's choices; "ocr" is a photo, "ocr_pdf" is a
 * scanned PDF.
 */
export function assetEligibleForTool(
  tool: string,
  asset: { kind: string; mime: string },
): boolean {
  switch (tool) {
    case "ocr":
      return asset.kind === "image";
    case "ocr_pdf":
      return asset.kind === "pdf";
    case "word_to_markdown":
      return asset.mime === DOCX_MIME;
    case "excel_to_csv":
      return asset.mime === XLSX_MIME;
    case "pdf_merge":
    case "pdf_split":
      return asset.kind === "pdf";
    case "office_to_pdf":
      return asset.mime === DOCX_MIME || asset.mime === PPTX_MIME;
    case "video_to_audio":
    case "compress_video":
      return asset.kind === "video";
    case "transcribe":
      return asset.kind === "audio" || asset.kind === "video";
    default:
      return false;
  }
}

export const createJobSchema = z.object({
  course_id: z.uuid(),
  type: z.enum(JOB_TYPES),
  input_asset_id: z.uuid(),
  params: jobParamsSchema,
});

export type CreateJobValues = z.infer<typeof createJobSchema>;

export const jobIdSchema = z.object({ job_id: z.uuid() });

/**
 * What the browser runner reports when the work is finished. Text results
 * (OCR, Word to Markdown) also carry the extracted text for the draft
 * note's body; binary results (merged/split PDF) do not.
 */
export const completeJobSchema = z.object({
  job_id: z.uuid(),
  /** Storage path of the uploaded result, inside the job's course folder. */
  result_path: z.string().min(1),
  mime: z.string().min(3).max(100),
  size_bytes: z.number().int().positive(),
  text: z.string().max(500_000).optional(),
});

export type CompleteJobValues = z.infer<typeof completeJobSchema>;

/**
 * The worker API bodies (spec section 7 rule 5). The worker posts these to
 * /api/worker/claim and /api/worker/complete with its token.
 */
export const workerClaimSchema = z.object({
  worker_name: z.string().min(1).max(40),
});

export const workerCompleteSchema = z.object({
  job_id: z.uuid(),
  ok: z.boolean(),
  error: z.string().max(500).optional(),
  result_path: z.string().min(1).optional(),
  mime: z.string().min(3).max(100).optional(),
  size_bytes: z.number().int().positive().optional(),
  text: z.string().max(500_000).optional(),
});

export type WorkerCompleteValues = z.infer<typeof workerCompleteSchema>;

/**
 * A worker counts as online if it claimed (or checked in) within this
 * window — three missed 10-second heartbeats.
 */
export const WORKER_ONLINE_WINDOW_MS = 90_000;

/** Human labels for the job screen. */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  ocr: "Read text from an image (OCR)",
  convert: "Convert a file",
  transcribe: "Audio to text",
  ai_task: "AI task",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  waiting_quota: "Waiting for AI quota",
};
