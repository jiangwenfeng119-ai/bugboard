type SpeechResult = { isFinal: boolean; 0: { transcript: string } };

type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function speechSupported() {
  return Boolean(speechCtor());
}

export function startLiveSpeech(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: () => void;
}) {
  const Ctor = speechCtor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "zh-CN";
  recognition.onresult = (event) => {
    let partial = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const piece = event.results[index][0]?.transcript || "";
      if (event.results[index].isFinal) handlers.onFinal(piece.trim());
      else partial += piece;
    }
    handlers.onPartial(partial.trim());
  };
  recognition.onerror = () => handlers.onEnd();
  recognition.onend = () => handlers.onEnd();
  try {
    recognition.start();
  } catch {
    return null;
  }
  return recognition;
}

function speechCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return host.SpeechRecognition || host.webkitSpeechRecognition || null;
}
