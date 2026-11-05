import { describe, expect, it } from "vitest";
import { parseProse } from "../src/lib/prose";

describe("parseProse", () => {
  it("keeps plain paragraphs and single line breaks", () => {
    const blocks = parseProse("第一段\n还在第一段\n\n第二段");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        lines: [
          [{ type: "text", text: "第一段" }],
          [{ type: "text", text: "还在第一段" }],
        ],
      },
      { type: "paragraph", lines: [[{ type: "text", text: "第二段" }]] },
    ]);
  });

  it("turns a leading label into a heading and keeps the sentence", () => {
    const blocks = parseProse("现象写在这里。\n\n期望：一个地方就能看清。");
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(blocks[1]).toEqual({
      type: "heading",
      level: 2,
      inlines: [{ type: "text", text: "期望" }],
    });
    expect(blocks[2]).toEqual({
      type: "paragraph",
      lines: [[{ type: "text", text: "一个地方就能看清。" }]],
    });
  });

  it("renders markdown headings and ordered steps", () => {
    const blocks = parseProse(
      "## 复现步骤\n1. 打开资产清单\n2、打开资产安全\n\n## 实际\n要来回切换。"
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "list",
      "heading",
      "paragraph",
    ]);
    expect(blocks[1]).toMatchObject({
      ordered: true,
      items: [
        [{ type: "text", text: "打开资产清单" }],
        [{ type: "text", text: "打开资产安全" }],
      ],
    });
  });

  it("renders bold, code, and http links, and leaves html as text", () => {
    const [paragraph] = parseProse(
      "见 **现在的表现** 与 `状态`，以及 [记录](https://example.com/a)。<b>不加粗</b>"
    );
    expect(paragraph).toMatchObject({
      type: "paragraph",
      lines: [
        [
          { type: "text", text: "见 " },
          { type: "strong", text: "现在的表现" },
          { type: "text", text: " 与 " },
          { type: "code", text: "状态" },
          { type: "text", text: "，以及 " },
          { type: "link", text: "记录", href: "https://example.com/a" },
          { type: "text", text: "。<b>不加粗</b>" },
        ],
      ],
    });
  });

  it("drops javascript links", () => {
    const [paragraph] = parseProse("[点我](javascript:alert(1))");
    expect(paragraph).toMatchObject({
      lines: [[{ type: "text", text: "[点我](javascript:alert(1))" }]],
    });
  });

  it("returns nothing for blank text", () => {
    expect(parseProse("  \n")).toEqual([]);
  });
});
