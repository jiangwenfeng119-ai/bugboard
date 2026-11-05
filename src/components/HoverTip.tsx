"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

type Tip = { x: number; y: number; above: boolean };

function clipped(el: HTMLElement) {
  if (el.scrollWidth > el.clientWidth + 1) return true;
  const child = el.firstElementChild;
  return (
    child instanceof HTMLElement && child.scrollWidth > child.clientWidth + 1
  );
}

export function HoverTip({
  text,
  children,
  always = false,
}: {
  text: string;
  children: React.ReactNode;
  always?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  function show() {
    const el = ref.current;
    if (!el || !text.trim()) return;
    if (!always && !clipped(el)) {
      setTip(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const above = rect.bottom + 72 > window.innerHeight && rect.top > 72;
    const x = Math.min(Math.max(8, rect.left), window.innerWidth - 28 * 16);
    setTip({ x, y: above ? rect.top - 6 : rect.bottom + 6, above });
  }

  return (
    <>
      <span
        ref={ref}
        className="bb-cell-clip"
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
      >
        {children}
      </span>
      {tip
        ? createPortal(
            <span
              className={tip.above ? "bb-hover-tip is-above" : "bb-hover-tip"}
              style={{ left: tip.x, top: tip.y }}
              role="tooltip"
            >
              {text}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
