"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useActionState,
} from "react";
import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assetEligibleForTool,
  CONVERT_TOOL_LABELS,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  OCR_LANGUAGE_LABELS,
  type JobStatus,
  type JobType,
  type OcrLanguage,
} from "@/lib/jobs";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  cancelJobAction,
  createJobAction,
  retryJobAction,
  type JobActionState,
} from "./actions";
import { JobRunner } from "./job-runner";

export type CourseOption = { id: string; code: string; title: string };
export type AssetOption = {
  id: string;
  course_id: string;
  title: string;
  kind: string;
  mime: string;
};
export type JobRow = {
  id: string;
  course_id: string;
  type: string;
  status: string;
  runner: string;
  params: unknown;
  error: string | null;
  attempts: number;
  run_after: string;
  created_by: string;
  created_at: string;
  finished_at: string | null;
  input_asset_id: string;
};

const TOOL_OPTIONS = [
  { value: "ocr", label: "Read text from a photo (OCR)" },
  { value: "ocr_pdf", label: "Read text from a scanned PDF (OCR)" },
  { value: "word_to_markdown", label: "Word to Markdown" },
  { value: "pdf_merge", label: "Merge PDFs" },
  { value: "pdf_split", label: "Split a PDF" },
  { value: "office_to_pdf", label: "Word or PowerPoint to PDF" },
  { value: "video_to_audio", label: "Video to audio (MP3)" },
  { value: "compress_video", label: "Compress a video" },
  { value: "transcribe", label: "Audio to text" },
] as const;
type ToolChoice = (typeof TOOL_OPTIONS)[number]["value"];

function assetEligible(asset: AssetOption, tool: ToolChoice): boolean {
  return assetEligibleForTool(tool, asset);
}

/** Stable UTC timestamp (no locale, so server and client render the same). */
function formatWhen(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

function statusBadgeVariant(status: JobStatus) {
  switch (status) {
    case "running":
      return "default" as const;
    case "failed":
      return "destructive" as const;
    case "done":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

/** One short line describing what the job was asked to do. */
function paramsSummary(type: string, params: unknown): string {
  const p = params as {
    languages?: OcrLanguage[];
    source?: string;
    tool?: string;
    asset_ids?: string[];
    pages?: string;
  };
  const languages = (p.languages ?? [])
    .map((l) => OCR_LANGUAGE_LABELS[l])
    .join(" + ");
  if (type === "ocr") {
    return p.source === "pdf_scan"
      ? `Scanned PDF OCR (${languages})`
      : languages;
  }
  if (type === "transcribe") {
    return `Audio to text (${languages})`;
  }
  if (type === "convert") {
    if (p.tool === "pdf_merge") {
      return `${CONVERT_TOOL_LABELS.pdf_merge} (${p.asset_ids?.length ?? 0} files)`;
    }
    if (p.tool === "pdf_split") {
      return `${CONVERT_TOOL_LABELS.pdf_split} (pages ${p.pages ?? ""})`;
    }
    if (p.tool && p.tool in CONVERT_TOOL_LABELS) {
      return CONVERT_TOOL_LABELS[p.tool as keyof typeof CONVERT_TOOL_LABELS];
    }
    return CONVERT_TOOL_LABELS.word_to_markdown;
  }
  return JOB_TYPE_LABELS[type as JobType] ?? type;
}

export function JobsClient({
  courses,
  assets,
  initialJobs,
  userId,
  isAdmin,
  workerOnline,
}: {
  courses: CourseOption[];
  assets: AssetOption[];
  initialJobs: JobRow[];
  userId: string;
  isAdmin: boolean;
  /** null when this leader cannot read worker heartbeats (non-admin). */
  workerOnline: boolean | null;
}) {
  const [jobs, setJobs] = useState(initialJobs);

  // Live status (spec section 7 rule 1): refetch whenever any job row changes.
  const refresh = useCallback(async () => {
    const supabase = createBrowserSupabase();
    const { data } = await supabase
      .from("jobs")
      .select(
        "id, course_id, type, status, runner, params, error, attempts, run_after, created_by, created_at, finished_at, input_asset_id",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) {
      setJobs(
        data.map((j) => ({
          id: j.id,
          course_id: j.course_id,
          type: j.type,
          status: j.status,
          runner: j.runner,
          params: j.params,
          error: j.error,
          attempts: j.attempts,
          run_after: j.run_after,
          created_by: j.created_by,
          created_at: j.created_at,
          finished_at: j.finished_at,
          input_asset_id: j.input_asset_id,
        })),
      );
    }
  }, []);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel("jobs-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "jobs" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const courseTitle = new Map(courses.map((c) => [c.id, c.title]));
  const assetTitle = new Map(assets.map((a) => [a.id, a.title]));

  return (
    <div className="grid gap-6">
      <JobRunner userId={userId} onSettled={() => void refresh()} />
      <JobForm
        courses={courses}
        assets={assets}
        onDone={() => void refresh()}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Recent jobs</CardTitle>
            {workerOnline !== null && (
              <Badge
                variant={workerOnline ? "default" : "secondary"}
                aria-live="polite"
              >
                Home Worker: {workerOnline ? "online" : "offline"}
              </Badge>
            )}
          </div>
          <CardDescription>
            Light jobs run in this browser while this screen is open. Heavy jobs
            (scanned PDFs, Office files, video, audio) wait for the Home Worker.
            A failed job retries itself up to three times, with a longer wait
            each time.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {jobs.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No jobs yet. Start one above.
            </p>
          )}
          {jobs.map((job) => (
            <div
              key={job.id}
              className="border-border rounded-lg border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusBadgeVariant(job.status as JobStatus)}>
                  {JOB_STATUS_LABELS[job.status as JobStatus] ?? job.status}
                </Badge>
                <span className="font-medium">
                  {paramsSummary(job.type, job.params)}
                </span>
              </div>
              <p className="text-muted-foreground mt-1">
                {courseTitle.get(job.course_id) ?? "Unknown course"} · Source:{" "}
                {assetTitle.get(job.input_asset_id) ?? "unknown file"} ·{" "}
                {formatWhen(job.created_at)}
              </p>
              {job.error && (
                <p role="alert" className="text-destructive mt-1">
                  {job.error}
                </p>
              )}
              {job.status === "queued" && job.attempts > 0 && (
                <p className="text-muted-foreground mt-1">
                  Trying again automatically.
                </p>
              )}
              {(job.created_by === userId || isAdmin) && (
                <JobRowActions job={job} onChanged={() => void refresh()} />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function JobForm({
  courses,
  assets,
  onDone,
}: {
  courses: CourseOption[];
  assets: AssetOption[];
  onDone: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [tool, setTool] = useState<ToolChoice>("ocr");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [assetId, setAssetId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const courseAssets = assets.filter(
    (a) => a.course_id === courseId && assetEligible(a, tool),
  );

  const [state, action, pending] = useActionState<JobActionState, FormData>(
    async (prev, fd) => {
      setLocalError(null);
      const needsLanguages =
        tool === "ocr" || tool === "ocr_pdf" || tool === "transcribe";
      const type = needsLanguages
        ? tool === "transcribe"
          ? "transcribe"
          : "ocr"
        : "convert";

      let params: unknown;
      if (needsLanguages) {
        const languages: OcrLanguage[] = [];
        if (fd.get("lang_eng") === "on") languages.push("eng");
        if (fd.get("lang_ara") === "on") languages.push("ara");
        if (languages.length === 0) {
          setLocalError("Pick at least one language.");
          return prev;
        }
        params =
          tool === "ocr"
            ? { type: "ocr", languages, source: "image" }
            : tool === "ocr_pdf"
              ? { type: "ocr", languages, source: "pdf_scan" }
              : { type: "transcribe", languages };
      } else if (tool === "word_to_markdown") {
        params = { type: "convert", tool: "word_to_markdown" };
      } else if (tool === "pdf_merge") {
        const picked = fd.getAll("merge_pdf").map(String);
        if (picked.length < 2) {
          setLocalError("Pick at least two PDFs to merge.");
          return prev;
        }
        params = { type: "convert", tool: "pdf_merge", asset_ids: picked };
      } else if (tool === "pdf_split") {
        const pages = String(fd.get("pages") ?? "").trim();
        if (!pages) {
          setLocalError("Say which pages to keep, like 1-3,5.");
          return prev;
        }
        params = { type: "convert", tool: "pdf_split", pages };
      } else {
        // office_to_pdf, video_to_audio, compress_video: no options.
        params = { type: "convert", tool };
      }

      fd.set("type", type);
      fd.set("params", JSON.stringify(params));
      if (tool === "pdf_merge") {
        fd.set("input_asset_id", fd.getAll("merge_pdf").map(String)[0]);
      }

      const result = await createJobAction(prev, fd);
      if (result && "ok" in result) {
        formRef.current?.reset();
        setAssetId("");
        onDone();
      }
      return result;
    },
    null,
  );

  if (courses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Start a job</CardTitle>
          <CardDescription>
            You are not in any course yet, so there is nothing to process.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a job</CardTitle>
        <CardDescription>
          Light jobs run right here in your browser. Heavy jobs (scanned PDFs,
          Office files, video, audio) wait for the Home Worker — a small program
          on your own computer. The result lands in the course as a draft note
          for you to review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tool">What should be done?</Label>
            <select
              id="tool"
              value={tool}
              onChange={(e) => {
                setTool(e.target.value as ToolChoice);
                setAssetId("");
              }}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              {TOOL_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="course_id">Course</Label>
            <select
              id="course_id"
              name="course_id"
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setAssetId("");
              }}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>

          {tool === "pdf_merge" ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">
                PDFs to merge (pick two or more, in order)
              </legend>
              {courseAssets.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  This course has no PDF files yet.
                </p>
              ) : (
                courseAssets.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="merge_pdf"
                      value={a.id}
                      className="size-4"
                    />
                    {a.title || "Untitled file"}
                  </label>
                ))
              )}
            </fieldset>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="input_asset_id">File</Label>
              {courseAssets.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  This course has no file this tool can work on yet.
                </p>
              ) : (
                <select
                  id="input_asset_id"
                  name="input_asset_id"
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  required
                >
                  <option value="" disabled>
                    Pick a file
                  </option>
                  {courseAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title || "Untitled file"}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {(tool === "ocr" || tool === "ocr_pdf" || tool === "transcribe") && (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">
                {tool === "transcribe"
                  ? "Languages in the recording"
                  : "Languages in the picture"}
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="lang_eng"
                  defaultChecked
                  className="size-4"
                />
                {OCR_LANGUAGE_LABELS.eng}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="lang_ara"
                  defaultChecked
                  className="size-4"
                />
                {OCR_LANGUAGE_LABELS.ara}
              </label>
            </fieldset>
          )}

          {tool === "pdf_split" && (
            <div className="grid gap-2">
              <Label htmlFor="pages">Pages to keep</Label>
              <Input
                id="pages"
                name="pages"
                inputMode="numeric"
                placeholder="1-3,5"
              />
            </div>
          )}

          {(localError || (state && "error" in state)) && (
            <p role="alert" className="text-destructive text-sm">
              {localError ?? (state && "error" in state ? state.error : "")}
            </p>
          )}

          <Button type="submit" disabled={pending} className="mt-2 w-fit">
            {pending ? "Starting…" : "Start job"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function JobRowActions({
  job,
  onChanged,
}: {
  job: JobRow;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const run = (
    serverAction: (
      prev: JobActionState,
      fd: FormData,
    ) => Promise<JobActionState>,
  ) => {
    const fd = new FormData();
    fd.set("job_id", job.id);
    startTransition(async () => {
      await serverAction(null, fd);
      onChanged();
    });
  };

  const cancellable = job.status === "queued" || job.status === "running";
  const retryable = job.status === "failed";
  if (!cancellable && !retryable) return null;

  return (
    <div className="mt-2 flex gap-2">
      {cancellable && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(cancelJobAction)}
        >
          Cancel
        </Button>
      )}
      {retryable && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(retryJobAction)}
        >
          Try again
        </Button>
      )}
    </div>
  );
}
