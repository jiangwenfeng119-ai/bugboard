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

/** Merge committed ask text with a new speech piece; empty piece keeps the base. */
export function joinAskSpeech(base: string, piece: string) {
  const head = base.trimEnd();
  const tail = piece.trim();
  if (!tail) return head;
  if (!head) return tail;
  if (head.endsWith(tail)) return head;
  if (tail.startsWith(head)) return tail;
  // Soft-committed interim at the end of head may be a prefix of the final piece
  for (let n = Math.min(head.length, tail.length); n >= 1; n -= 1) {
    if (head.endsWith(tail.slice(0, n))) {
      return `${head.slice(0, head.length - n)}${tail}`;
    }
  }
  const needSpace = /[A-Za-z0-9]$/.test(head) && /^[A-Za-z0-9]/.test(tail);
  return needSpace ? `${head} ${tail}` : `${head}${tail}`;
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
