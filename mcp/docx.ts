import zlib from "zlib";

export function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip");

  const count = buf.readUInt16LE(eocd + 8);
  if (count === 0xffff) throw new Error("不支持 zip64");
  let offset = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();

  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("zip 中央目录损坏");
    }
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOff = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (localOff + 30 > buf.length) throw new Error("zip 本地头损坏");
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) files.set(name, Buffer.from(compressed));
    else if (method === 8) files.set(name, zlib.inflateRawSync(compressed));
    else throw new Error(`不支持的压缩方式 ${method}`);
  }
  return files;
}

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function extractDocx(buffer: Buffer): {
  text: string;
  media: { filename: string; data: Buffer }[];
} {
  const files = readZip(buffer);
  const xml = files.get("word/document.xml");
  if (!xml) throw new Error("docx 缺少 word/document.xml");
  const lines: string[] = [];
  for (const para of xml.toString("utf8").split(/<\/w:p>/)) {
    const line = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((match) => decodeXml(match[1]))
      .join("");
    if (line.trim()) lines.push(line);
  }
  const media = [...files.entries()]
    .filter(([name]) => name.startsWith("word/media/") && !name.endsWith("/"))
    .map(([name, data]) => ({
      filename: name.slice("word/media/".length),
      data,
    }));
  return { text: lines.join("\n"), media };
}
