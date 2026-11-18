import { ASK_IMAGE_MAX_BYTES, ASK_IMAGE_MAX_COUNT } from "./ask-core";

const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function askPasteName(type: string, name: string, index: number) {
  const fromType = MIME_EXT[String(type || "").toLowerCase()] || "";
  const fromName = String(name || "")
    .toLowerCase()
    .match(/\.(png|jpe?g|webp|gif)$/)?.[0];
  const ext = fromType || (fromName === ".jpeg" ? ".jpg" : fromName || "");
  if (!ext) return "";
  return `paste-${index + 1}${ext}`;
}

type ClipItem = {
  kind?: string;
  type: string;
  getAsFile: () => File | null;
};

export function filesFromClipboard(
  data: { items?: ArrayLike<ClipItem> } | null,
  already = 0
) {
  const files: File[] = [];
  let skipped = 0;
  const items = data?.items ? Array.from(data.items) : [];
  const room = Math.max(0, ASK_IMAGE_MAX_COUNT - already);
  for (const item of items) {
    if (item.kind && item.kind !== "file") continue;
    const file = item.getAsFile();
    const type = item.type || file?.type || "";
    const rawName = file?.name || "";
    if (!type.startsWith("image/") && !askPasteName("", rawName, 0)) continue;
    if (!file || file.size <= 0 || files.length >= room || file.size > ASK_IMAGE_MAX_BYTES) {
      skipped += 1;
      continue;
    }
    const name = askPasteName(type, rawName, already + files.length);
    if (!name) {
      skipped += 1;
      continue;
    }
    files.push(new File([file], name, { type: type || "image/png" }));
  }
  return { files, skipped };
}

export function pickAskPictures<T extends { file: { type: string; size: number; name?: string } }>(
  pasted: T[],
  attached: T[]
) {
  const pictures = [...pasted, ...attached].filter((item) => {
    const type = item.file.type || "";
    const name = item.file.name || "";
    return type.startsWith("image/") || Boolean(askPasteName(type, name, 0));
  });
  const chosen = pictures.filter((item) => item.file.size <= ASK_IMAGE_MAX_BYTES).slice(0, ASK_IMAGE_MAX_COUNT);
  return { chosen, dropped: pictures.length > chosen.length };
}
