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

/**
 * Params per job type, validated before the row is written. The jobs.type
 * enum (spec section 5) has only four values, so the PDF tools are
 * "convert" jobs whose params say which tool runs.
 */
export const convertTools = [
  "word_to_markdown",
  "pdf_merge",
  "pdf_split",
] as const;
export type ConvertTool = (typeof convertTools)[number];

export const CONVERT_TOOL_LABELS: Record<ConvertTool, string> = {
  word_to_markdown: "Word to Markdown",
  pdf_merge: "Merge PDFs",
  pdf_split: "Split a PDF",
};

export const jobParamsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ocr"),
    languages: ocrLanguagesSchema,
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
  // transcribe and ai_task arrive with M6/M7; their params are defined then.
]);

export type JobParams = z.infer<typeof jobParamsSchema>;

export const createJobSchema = z.object({
  course_id: z.uuid(),
  type: z.enum(JOB_TYPES),
  runner: z.enum(JOB_RUNNERS),
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
