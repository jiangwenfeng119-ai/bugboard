"use client";

import { useEffect, useState } from "react";
import { shouldShowBackToTop } from "@/lib/back-to-top";
import { IconArrowUp } from "./Icons";

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function sync() {
      setVisible(shouldShowBackToTop(window.scrollY));
    }
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="bb-back-top"
      aria-label="回到顶部"
      title="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <IconArrowUp size={18} />
      <span>回到顶部</span>
    </button>
  );
}
