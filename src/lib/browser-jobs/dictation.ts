/**
 * Live dictation in the note editor (spec section 7): the browser's own
 * speech recognition (Web Speech API) turns speech into text while the
 * leader speaks. No cloud service of our own — the browser vendor provides
 * the engine, so nothing to host and nothing to pay for.
 *
 * The Web Speech API is not in every TypeScript DOM lib and is prefixed
 * `webkit` in some browsers, so this module declares the small surface it
 * needs and never touches `any`.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The dictation language for an OCR-language code (same picker, same pair). */
export function dictationLocale(language: "eng" | "ara"): string {
  return language === "ara" ? "ar" : "en-US";
}

/** True when this browser can dictate. Call only in the browser. */
export function dictationSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return "SpeechRecognition" in w || "webkitSpeechRecognition" in w;
}

function createRecognition(lang: string): SpeechRecognitionLike {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    throw new Error("This browser does not support dictation.");
  }
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  return recognition;
}

export type DictationHandlers = {
  /** A finished phrase, ready to insert into the note. */
  onFinal: (text: string) => void;
  /** The half-said phrase currently being spoken (live caption). */
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  /** Dictation stopped for good (the leader pressed stop, or it must). */
  onEnd: () => void;
};

const FATAL_ERRORS = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "no-speech",
]);

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "The microphone is blocked for this site. Allow it and try again.",
  "service-not-allowed":
    "Dictation was blocked by the browser. Try again later.",
  "audio-capture": "No microphone was found.",
  "no-speech": "Nothing was heard. Press Dictate and speak again.",
  network: "Dictation needs a connection. Try again when online.",
};

/**
 * One dictation session. Browsers end recognition after a pause; while the
 * leader still wants dictation, start() is called again automatically —
 * except after a real problem (no microphone, blocked permission, long
 * silence), where looping would churn the network for nothing.
 */
export class Dictation {
  private recognition: SpeechRecognitionLike | null = null;
  private wanted = false;

  get active(): boolean {
    return this.wanted;
  }

  start(lang: string, handlers: DictationHandlers): void {
    this.wanted = true;
    let recognition: SpeechRecognitionLike;
    try {
      recognition = createRecognition(lang);
    } catch {
      this.wanted = false;
      handlers.onError("This browser does not support dictation.");
      return;
    }
    this.recognition = recognition;

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const text = transcript.trim();
          if (text) handlers.onFinal(text);
        } else {
          interim += transcript;
        }
      }
      handlers.onInterim(interim.trim());
    };

    recognition.onerror = (event) => {
      if (!FATAL_ERRORS.has(event.error)) return; // transient: onend restarts
      this.wanted = false;
      handlers.onError(
        ERROR_MESSAGES[event.error] ?? "Dictation stopped. Try again.",
      );
    };

    recognition.onend = () => {
      if (!this.wanted) {
        handlers.onEnd();
        return;
      }
      // The leader still wants dictation; the browser just paused. Restart.
      try {
        recognition.start();
      } catch {
        this.wanted = false;
        handlers.onEnd();
      }
    };

    try {
      recognition.start();
    } catch {
      this.wanted = false;
      handlers.onError("Dictation could not start. Try again.");
    }
  }

  stop(): void {
    this.wanted = false;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) recognition.stop();
  }
}
