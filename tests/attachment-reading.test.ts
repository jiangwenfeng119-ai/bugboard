import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { ADMIN_AGENT_PROMPT, USER_AGENT_PROMPT } from "../src/lib/agent-prompts";
import { extractDocx } from "../mcp/docx";
import { enrichBugDetail } from "../mcp/materialize";

function zip(
  entries: { name: string; data: Buffer; deflate?: boolean }[]
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const method = entry.deflate ? 8 : 0;
    const data = entry.deflate ? zlib.deflateRawSync(entry.data) : entry.data;
    const crc = zlib.crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localFull = Buffer.concat([local, name, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    locals.push(localFull);
    offset += localFull.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const DOC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>问题1: 拓扑图挤在一排</w:t></w:r></w:p>
    <w:p><w:r><w:t>字段 &amp; 截图</w:t></w:r></w:p>
  </w:body>
</w:document>`;

function sampleDocx() {
  return zip([
    { name: "word/document.xml", data: Buffer.from(DOC_XML), deflate: true },
    { name: "word/media/image1.png", data: Buffer.from("png-bytes") },
  ]);
}

describe("extractDocx", () => {
  it("returns paragraph text and embedded images", () => {
    const extracted = extractDocx(sampleDocx());
    expect(extracted.text).toBe("问题1: 拓扑图挤在一排\n字段 & 截图");
    expect(extracted.media).toEqual([
      { filename: "image1.png", data: Buffer.from("png-bytes") },
    ]);
  });
});

describe("enrichBugDetail", () => {
  it("puts docx text and image files on the bug the agent already reads", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-att-"));
    const docx = sampleDocx();
    let downloads = 0;
    const { detail, images } = await enrichBugDetail(
      {
        bug: { id: 9, body: "具体请查看附件" },
        attachments: [
          {
            id: 3,
            filename: "soc修复后仍存在的问题.docx",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: docx.length,
            storage_path: "bug/9/secret.docx",
          },
        ],
        events: [
          {
            id: 1,
            attachments: [
              {
                id: 8,
                filename: "note.txt",
                mime: "text/plain",
                size: Buffer.byteLength("时间线说明"),
                storage_path: "event/1/note.txt",
              },
            ],
          },
        ],
      },
      {
        root,
        download: async (id) => {
          downloads += 1;
          if (id === 3) return docx;
          if (id === 8) return Buffer.from("时间线说明");
          throw new Error(`unexpected ${id}`);
        },
      }
    );

    expect(detail.attachments[0].text).toBe("问题1: 拓扑图挤在一排\n字段 & 截图");
    expect(detail.attachments[0].storage_path).toBeUndefined();
    expect(fs.existsSync(detail.attachments[0].localPath)).toBe(true);
    expect(detail.attachments[0].media).toHaveLength(1);
    expect(fs.existsSync(detail.attachments[0].media[0].localPath)).toBe(true);
    expect(detail.events[0].attachments[0].text).toBe("时间线说明");
    expect(detail.reading).toContain("text");
    expect(detail.reading).toContain("不要");
    expect(images.map((img) => img.label)).toContain(
      "附件 soc修复后仍存在的问题.docx / image1.png"
    );

    const again = await enrichBugDetail(detail, {
      root,
      download: async () => {
        downloads += 1;
        throw new Error("should use cache");
      },
    });
    expect(again.detail.attachments[0].text).toContain("问题1");
    expect(downloads).toBe(2);
  });

  it("keeps the bug readable when an attachment cannot be downloaded", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-att-"));
    const { detail } = await enrichBugDetail(
      {
        bug: { id: 1, body: "具体请查看附件" },
        attachments: [
          { id: 4, filename: "missing.docx", mime: "application/octet-stream", size: 10 },
        ],
        events: [],
      },
      {
        root,
        download: async () => {
          throw new Error("HTTP 404");
        },
      }
    );
    expect(detail.attachments[0].text).toBeNull();
    expect(detail.attachments[0].readError).toContain("HTTP 404");
    expect(detail.reading).toContain("missing.docx");
  });
});

describe("agent prompts", () => {
  it("requires the fixer to read attachment text before judging", () => {
    expect(ADMIN_AGENT_PROMPT).not.toContain("不下发附件");
    expect(ADMIN_AGENT_PROMPT).toContain("attachments");
    expect(ADMIN_AGENT_PROMPT).toContain("text");
    expect(ADMIN_AGENT_PROMPT).toContain("见附件");
    expect(ADMIN_AGENT_PROMPT).toContain("不要 mark_invalid");
    expect(USER_AGENT_PROMPT).toContain("附件");
  });
});
