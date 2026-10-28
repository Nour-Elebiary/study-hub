"use client";

import { useEffect, useRef } from "react";
import { convertWordToMarkdown } from "@/lib/browser-jobs/convert";
import { runOcr } from "@/lib/browser-jobs/ocr";
import { mergePdfs, splitPdf } from "@/lib/browser-jobs/pdf";
import { randomStoragePath } from "@/lib/file-allowlist";
import {
  jobParamsSchema,
  MAX_JOB_ATTEMPTS,
  retryDelaySeconds,
} from "@/lib/jobs";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { completeJobAction } from "./actions";

/**
 * The browser runner (spec section 7): while the Jobs screen is open, this
 * component picks up the leader's own queued browser jobs, runs them here in
 * the browser, uploads the result, and asks the server to file it. Light
 * work only — the Home Worker (M6) handles the heavy jobs.
 */

type QueuedJob = {
  id: string;
  course_id: string;
  type: string;
  params: unknown;
  input_asset_id: string;
  attempts: number;
};

type Supabase = ReturnType<typeof createBrowserSupabase>;

/** Puts the job back in the queue with a longer delay, or fails it for good. */
async function requeueOrFail(
  supabase: Supabase,
  job: QueuedJob,
  message: string,
): Promise<void> {
  const attempts = job.attempts + 1;
  if (attempts < MAX_JOB_ATTEMPTS) {
    await supabase
      .from("jobs")
      .update({
        status: "queued",
        attempts,
        run_after: new Date(
          Date.now() + retryDelaySeconds(attempts) * 1000,
        ).toISOString(),
        error: message,
      })
      .eq("id", job.id);
  } else {
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        attempts,
        error: message,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}

/** Runs one claimed job and reports the result through the server action. */
async function runJob(supabase: Supabase, job: QueuedJob): Promise<void> {
  const parsed = jobParamsSchema.safeParse(job.params);
  if (!parsed.success || parsed.data.type !== job.type) {
    throw new Error("The job's options are invalid.");
  }
  const params = parsed.data;

  const { data: source } = await supabase
    .from("assets")
    .select("title, path_or_url")
    .eq("id", job.input_asset_id)
    .maybeSingle();
  if (!source) throw new Error("The source file is gone.");
  const sourceTitle = source.title || "file";

  const { data: blob, error: downloadError } = await supabase.storage
    .from("assets")
    .download(source.path_or_url);
  if (downloadError || !blob) {
    throw new Error("Could not download the source file.");
  }

  let result: Blob | null = null;
  let resultMime = "application/pdf";
  let resultTitle = sourceTitle;
  let text: string | undefined;

  if (params.type === "ocr") {
    text = await runOcr(blob, params.languages);
    resultMime = "text/plain";
    resultTitle = `${sourceTitle} (text).md`;
  } else if (params.type === "convert" && params.tool === "word_to_markdown") {
    text = await convertWordToMarkdown(await blob.arrayBuffer());
    resultMime = "text/plain";
    resultTitle = `${sourceTitle} (text).md`;
  } else if (params.type === "convert" && params.tool === "pdf_merge") {
    const parts: ArrayBuffer[] = [];
    for (const assetId of params.asset_ids ?? []) {
      const { data: part } = await supabase
        .from("assets")
        .select("path_or_url")
        .eq("id", assetId)
        .maybeSingle();
      if (!part) throw new Error("One of the PDFs to merge is gone.");
      const { data: partBlob, error } = await supabase.storage
        .from("assets")
        .download(part.path_or_url);
      if (error || !partBlob) {
        throw new Error("Could not download one of the PDFs to merge.");
      }
      parts.push(await partBlob.arrayBuffer());
    }
    const merged = await mergePdfs(parts);
    result = new Blob([merged.slice()], { type: "application/pdf" });
    resultTitle = `${sourceTitle} (merged).pdf`;
  } else if (params.type === "convert" && params.tool === "pdf_split") {
    const split = await splitPdf(await blob.arrayBuffer(), params.pages ?? "");
    if (!split) throw new Error("Those page numbers do not fit the document.");
    result = new Blob([split.slice()], { type: "application/pdf" });
    resultTitle = `${sourceTitle} (split).pdf`;
  } else {
    throw new Error("This job does not run in the browser.");
  }

  if (!result) {
    result = new Blob([text ?? ""], { type: "text/plain" });
  }

  const path = randomStoragePath(job.course_id, resultTitle);
  const { error: uploadError } = await supabase.storage
    .from("assets")
    .upload(path, result, { contentType: resultMime });
  if (uploadError) throw new Error("Could not save the result file.");

  const report = new FormData();
  report.set("job_id", job.id);
  report.set("result_path", path);
  report.set("mime", resultMime);
  report.set("size_bytes", String(result.size));
  if (text !== undefined) report.set("text", text);

  const done = await completeJobAction(null, report);
  if (done && "error" in done) throw new Error(done.error);
}

/** Finds the leader's next due browser job, claims it, and runs it. */
async function pickAndRun(
  supabase: Supabase,
  userId: string,
): Promise<boolean> {
  const { data: due } = await supabase
    .from("jobs")
    .select("id, course_id, type, params, input_asset_id, attempts")
    .eq("created_by", userId)
    .eq("runner", "browser")
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);
  const job = due?.[0] as QueuedJob | undefined;
  if (!job) return false;

  // Claim the job: the update only matches while it is still queued, so two
  // open tabs can never run the same job twice.
  const { data: claimed } = await supabase
    .from("jobs")
    .update({ status: "running" })
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id");
  if (!claimed || claimed.length === 0) return false;

  try {
    await runJob(supabase, job);
  } catch (err) {
    await requeueOrFail(
      supabase,
      job,
      err instanceof Error ? err.message : "The job failed.",
    );
  }
  return true;
}

export function JobRunner({
  userId,
  onSettled,
}: {
  userId: string;
  onSettled: () => void;
}) {
  const busyRef = useRef(false);
  const settledRef = useRef(onSettled);

  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    const tick = async () => {
      if (cancelled || busyRef.current) return;
      busyRef.current = true;
      try {
        const ran = await pickAndRun(supabase, userId);
        if (ran) settledRef.current();
      } finally {
        busyRef.current = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);

  return null;
}
