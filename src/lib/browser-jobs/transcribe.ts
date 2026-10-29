/**
 * Browser transcription fallback (spec section 7 table): for audio up to 10
 * minutes the leader's own browser can transcribe with a small Whisper model
 * through Transformers.js, used when the Home Worker is offline. The audio
 * never leaves the device — decoding happens here, inference in a web
 * worker (whisper-worker.ts).
 */
import type { OcrLanguage } from "@/lib/jobs";

/**
 * The Whisper language code for the leader's language choice. One language
 * is forced (spec section 7 rule 4: no auto-detect); both together let the
 * model switch per chunk, which is what mixed-language lectures need.
 */
export function whisperLanguageFor(
  languages: OcrLanguage[],
): string | undefined {
  if (languages.length === 1) {
    return languages[0] === "ara" ? "ar" : "en";
  }
  return undefined;
}

/** Decodes any browser-supported audio file to mono 16 kHz PCM. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextCtor = w.AudioContext ?? w.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("This browser cannot read audio files.");
  }
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());

    // Mix every channel down to one average channel at the file's rate.
    const mono = context.createBuffer(1, decoded.length, decoded.sampleRate);
    const target = mono.getChannelData(0);
    for (let i = 0; i < decoded.length; i += 1) {
      let sum = 0;
      for (let c = 0; c < decoded.numberOfChannels; c += 1) {
        sum += decoded.getChannelData(c)[i] ?? 0;
      }
      target[i] = sum / decoded.numberOfChannels;
    }

    // Resample to the 16 kHz Whisper expects.
    const frames = Math.max(1, Math.ceil(decoded.duration * 16_000));
    const offline = new OfflineAudioContext(1, frames, 16_000);
    const source = offline.createBufferSource();
    source.buffer = mono;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    void context.close();
  }
}

/**
 * Transcribes an audio blob in this browser. Resolves with the transcript
 * text; rejects with a plain-language message on failure.
 */
export async function transcribeInBrowser(
  blob: Blob,
  languages: OcrLanguage[],
): Promise<string> {
  const audio = await decodeToMono16k(blob);
  const worker = new Worker(new URL("./whisper-worker.ts", import.meta.url), {
    type: "module",
  });

  return new Promise<string>((resolve, reject) => {
    worker.addEventListener(
      "message",
      (
        event: MessageEvent<{ kind: string; text?: string; message?: string }>,
      ) => {
        const message = event.data;
        if (message.kind === "done") {
          worker.terminate();
          resolve(message.text ?? "");
        } else if (message.kind === "error") {
          worker.terminate();
          reject(new Error(message.message ?? "Transcription failed."));
        }
      },
    );
    worker.addEventListener("error", () => {
      worker.terminate();
      reject(new Error("The transcription engine could not start."));
    });

    const language = whisperLanguageFor(languages);
    // The buffer is transferred (zero-copy); it is not used again here.
    worker.postMessage({ kind: "start", audio, language }, [audio.buffer]);
  });
}
