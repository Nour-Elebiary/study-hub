/// <reference lib="webworker" />
/**
 * The browser Whisper worker (spec section 7): runs the Transformers.js
 * speech-recognition pipeline off the main thread so the page keeps
 * responding while a recording is transcribed. The model
 * (onnx-community/whisper-tiny, a small multilingual Whisper) is downloaded
 * from the Hugging Face Hub on first use and cached by the browser
 * afterwards; it runs locally on the leader's device.
 */
import { pipeline } from "@huggingface/transformers";

type StartMessage = {
  kind: "start";
  /** Mono 16 kHz PCM samples (transferred, not copied). */
  audio: Float32Array;
  /** Whisper language code, or undefined to let the model detect it. */
  language?: string;
};

type DoneMessage = { kind: "done"; text: string };
type ErrorMessage = { kind: "error"; message: string };
type OutgoingMessage = DoneMessage | ErrorMessage;

/** Minimal typed surface of the worker scope (avoids lib conflicts). */
const ctx = self as unknown as {
  postMessage: (message: OutgoingMessage) => void;
  addEventListener(
    type: "message",
    listener: (event: { data: StartMessage }) => void,
  ): void;
};

let engine: Promise<{
  (
    audio: Float32Array,
    options: Record<string, unknown>,
  ): Promise<{ text: string } | string>;
}> | null = null;

function getEngine() {
  if (!engine) {
    engine = pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-tiny",
      {
        dtype: "q8",
      },
    ) as never;
  }
  return engine;
}

ctx.addEventListener("message", (event) => {
  const message = event.data;
  if (message.kind !== "start") return;
  void (async () => {
    try {
      const transcriber = await getEngine();
      const output = await transcriber(message.audio, {
        // Long-form: sliding 30-second windows with 5-second overlap, the
        // same chunking the Home Worker uses (spec section 7 rule 3).
        chunk_length_s: 30,
        stride_length_s: 5,
        ...(message.language ? { language: message.language } : {}),
      });
      const text = typeof output === "string" ? output : output.text;
      ctx.postMessage({ kind: "done", text: text.trim() });
    } catch (err) {
      ctx.postMessage({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Transcription failed in the browser.",
      });
    }
  })();
});
