"use client";

import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

type Props = {
  src: string;
  alt?: string;
  /** Thumbnail / inline image class. */
  className?: string;
  width?: number;
  height?: number;
  style?: CSSProperties;
};

export function ImageLightbox({
  src,
  alt = "",
  className,
  width,
  height,
  style,
}: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("bb-modal-open");
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bb-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openViewer(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  }

  function onThumbKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  }

  return (
    <>
      <button
        type="button"
        className="bb-lightbox-thumb"
        onClick={openViewer}
        onKeyDown={onThumbKey}
        aria-label={alt ? `放大查看：${alt}` : "放大查看图片"}
        title="点击放大查看"
      >
        {/* 附件地址由本系统签发或为本地预览。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className={className}
          width={width}
          height={height}
          style={style}
        />
      </button>
      {mounted && open
        ? createPortal(
            <div className="bb-modal bb-lightbox" role="presentation">
              <button
                type="button"
                className="bb-modal-backdrop"
                aria-label="关闭预览"
                onClick={() => setOpen(false)}
              />
              <div
                className="bb-lightbox-stage"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
              >
                <p id={titleId} className="bb-sr-only">
                  {alt || "图片预览"}
                </p>
                <button
                  type="button"
                  className="bb-lightbox-close"
                  onClick={() => setOpen(false)}
                >
                  关闭
                </button>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="bb-lightbox-img" src={src} alt={alt} />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
