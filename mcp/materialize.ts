import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { extractDocx } from "./docx";

export const TEXT_LIMIT = 30_000;
export const INLINE_IMAGE_BYTES = 1_500_000;
export const MAX_INLINE_IMAGES = 8;

const TEXT_EXT = new Set([".txt", ".md", ".csv", ".log", ".json"]);

export function agentFilesRoot() {
  return (
    process.env.BUGBOARD_AGENT_FILES ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "agent-files")
  );
}

type RawAttachment = {
  id: number;
  filename: string;
  mime?: string;
  size?: number;
  storage_path?: string;
  [key: string]: unknown;
};

type BugDetail = {
  bug?: { id?: number };
  attachments?: RawAttachment[];
  events?: ({ attachments?: RawAttachment[] } & Record<string, unknown>)[];
  [key: string]: unknown;
};

export type InlineImage = {
  label: string;
  mimeType: string;
  data: string;
};

function safeName(filename: string) {
  const base = path.basename(filename).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  return base || "file";
}

function mimeFromName(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "";
}

function clip(text: string) {
  if (text.length <= TEXT_LIMIT) return { text, textTruncated: false };
  return { text: text.slice(0, TEXT_LIMIT), textTruncated: true };
}

function considerImage(
  images: InlineImage[],
  skipped: string[],
  label: string,
  filename: string,
  data: Buffer,
  mime?: string
) {
  const mimeType =
    mime && mime.startsWith("image/") ? mime : mimeFromName(filename);
  if (!mimeType.startsWith("image/")) return;
  if (data.length > INLINE_IMAGE_BYTES || images.length >= MAX_INLINE_IMAGES) {
    skipped.push(label);
    return;
  }
  images.push({ label, mimeType, data: data.toString("base64") });
}

async function prepareOne(
  att: RawAttachment,
  bugId: number,
  root: string,
  download: (id: number) => Promise<Buffer>,
  images: InlineImage[],
  skipped: string[]
) {
  const rest = { ...att };
  delete rest.storage_path;
  const prepared = {
    ...rest,
    localPath: null as string | null,
    text: null as string | null,
    textTruncated: false,
    media: [] as { filename: string; localPath: string }[],
    readError: null as string | null,
  };
  try {
    const dir = path.join(root, String(bugId));
    fs.mkdirSync(dir, { recursive: true });
    const localPath = path.join(dir, `${att.id}_${safeName(att.filename)}`);
    const cached =
      fs.existsSync(localPath) &&
      (att.size == null || fs.statSync(localPath).size === att.size);
    const buf = cached ? fs.readFileSync(localPath) : await download(att.id);
    if (!cached) fs.writeFileSync(localPath, buf);
    prepared.localPath = localPath;

    const ext = path.extname(att.filename).toLowerCase();
    if (ext === ".docx") {
      const extracted = extractDocx(buf);
      const clipped = clip(extracted.text);
      prepared.text = clipped.text;
      prepared.textTruncated = clipped.textTruncated;
      const mediaDir = path.join(dir, `${att.id}_media`);
      fs.mkdirSync(mediaDir, { recursive: true });
      for (const media of extracted.media) {
        const mediaPath = path.join(mediaDir, safeName(media.filename));
        fs.writeFileSync(mediaPath, media.data);
        prepared.media.push({ filename: media.filename, localPath: mediaPath });
        considerImage(
          images,
          skipped,
          `附件 ${att.filename} / ${media.filename}`,
          media.filename,
          media.data
        );
      }
    } else if (TEXT_EXT.has(ext)) {
      const clipped = clip(buf.toString("utf8"));
      prepared.text = clipped.text;
      prepared.textTruncated = clipped.textTruncated;
    } else if (mimeFromName(att.filename) || (att.mime || "").startsWith("image/")) {
      considerImage(
        images,
        skipped,
        `附件 ${att.filename}`,
        att.filename,
        buf,
        att.mime
      );
    }
  } catch (e) {
    prepared.readError = e instanceof Error ? e.message : String(e);
  }
  return prepared;
}

function readingFor(
  attachments: { filename: string; readError: string | null }[],
  skipped: string[]
) {
  const failed = attachments.filter((att) => att.readError).map((att) => att.filename);
  let text =
    "附件正文在 text，文档内图片在 media，图片会随工具结果返回。正文只写「见附件」或「具体请查看附件」时，以 text 和图片为准。没读完这些内容之前，不要 mark_invalid，也不要 request_product，也不要 request_info，也不要判定现象不存在或已修复。要一个现在没有的能力是改产品：只认提交时的正文或附件写明已经和产品经理或 Marshal 沟通确认，按确认过的需求改。时间线、异议和后补说明里的确认不算。没有提交时的确认就 request_product，说明里写这张在等产品经理决定，仓库保持原样。现象不存在、已经有这个功能但没用对、配置不对，才 mark_invalid。修复说明、不属实原因和补充要求写给报障人：用界面上能看到的话，不要写文件名、函数名、接口或实现细节。缺的材料只在报障人手里时才 request_info；报障已经写清、只是还没定位到原因的，保持原状态。";
  if (failed.length) {
    text += ` 这些附件没能读出：${failed.join("、")}。读不出就停下来说明，不要据此标不属实。`;
  }
  if (skipped.length) {
    text += ` 以下图片未内联，请打开 localPath：${skipped.join("、")}。`;
  }
  return text;
}

export async function enrichBugDetail(
  detail: BugDetail,
  opts: { root: string; download: (id: number) => Promise<Buffer> }
) {
  const bugId = Number(detail?.bug?.id) || 0;
  const images: InlineImage[] = [];
  const skipped: string[] = [];
  const attachments = [];
  for (const att of detail.attachments || []) {
    attachments.push(
      await prepareOne(att, bugId, opts.root, opts.download, images, skipped)
    );
  }
  const events = [];
  for (const event of detail.events || []) {
    const eventAttachments = [];
    for (const att of event.attachments || []) {
      eventAttachments.push(
        await prepareOne(att, bugId, opts.root, opts.download, images, skipped)
      );
    }
    events.push({ ...event, attachments: eventAttachments });
  }
  const all = [
    ...attachments,
    ...events.flatMap((event) => event.attachments),
  ];
  return {
    detail: {
      ...detail,
      attachments,
      events,
      ...(all.length ? { reading: readingFor(all, skipped) } : {}),
    },
    images,
  };
}
