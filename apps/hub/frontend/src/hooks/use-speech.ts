import { useCallback, useEffect, useRef, useState } from "react";

// Dictation for the composer, from the browser's own recogniser.
//
// No audio reaches the hub and no second API key exists: the browser does the
// recognition and hands back text. The cost is that support is uneven, which is
// why `supported` is a real piece of state the UI reads rather than an
// assumption — Firefox has no implementation at all, and every implementation
// requires a secure context, so this is off on the plain-HTTP LAN address and on
// until `monitoring.davideghiotto.it` is published through the tunnel.
//
// TypeScript ships no types for any of this, so the shape is declared here.

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlternative; length: number };
type SpeechResultList = { length: number; [i: number]: SpeechResult };

type SpeechEvent = { resultIndex: number; results: SpeechResultList };
type SpeechErrorEvent = { error: string };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  // Chrome and Edge ship it prefixed; Safari 17+ ships it unprefixed.
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type Speech = {
  /** False on Firefox, and false over plain HTTP anywhere. The mic hides rather
   *  than offering a button that cannot work. */
  supported: boolean;
  listening: boolean;
  /** Why it stopped, when it stopped badly. `not-allowed` is the common one: the
   *  microphone permission was refused. */
  error: string | null;
  start: () => void;
  stop: () => void;
};

/** `onText` is called with the best transcript so far, interim results
 *  included, so the input fills in while someone is still talking. `final` says
 *  whether the recogniser has committed to it. */
export function useSpeech(onText: (text: string, final: boolean) => void): Speech {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);

  // A ref, so restarting the recogniser is not required every time the
  // composer's onChange identity changes.
  const sink = useRef(onText);
  sink.current = onText;

  const supported = ctor() !== null && typeof window !== "undefined" && window.isSecureContext;

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = ctor();
    if (!Ctor || !window.isSecureContext) return;

    recognition.current?.abort();
    const r = new Ctor();
    // Follows the page, so a browser set to Italian dictates Italian.
    r.lang = document.documentElement.lang || navigator.language || "en-GB";
    r.continuous = false;
    r.interimResults = true;

    r.onresult = (e) => {
      let text = "";
      let final = false;
      for (let i = 0; i < e.results.length; i += 1) {
        const result = e.results[i];
        if (!result) continue;
        text += result[0].transcript;
        if (result.isFinal) final = true;
      }
      sink.current(text.trim(), final);
    };
    r.onerror = (e) => {
      // `aborted` is what a deliberate stop() raises. Reporting it would put an
      // error under the composer every time someone stopped talking on purpose.
      if (e.error !== "aborted" && e.error !== "no-speech") setError(e.error);
      setListening(false);
    };
    r.onend = () => setListening(false);

    recognition.current = r;
    setError(null);
    try {
      r.start();
      setListening(true);
    } catch {
      // start() throws if called while already running; nothing to report.
      setListening(false);
    }
  }, []);

  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, error, start, stop };
}
