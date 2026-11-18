import { describe, expect, it } from "vitest";
import { markdownBlocks, markdownInlines } from "../src/lib/markdown-lite";

describe("markdown lite", () => {
  it("turns map markdown into headings, lists, and inline marks", () => {
    const blocks = markdownBlocks(
      "### App 壳\n- **登录** · `/login` · `apps/mobile/app/login.tsx`\n普通一行\n判断：已经有了"
    );
    expect(blocks).toEqual([
      { type: "h", level: 3, text: "App 壳" },
      { type: "ul", items: ["**登录** · `/login` · `apps/mobile/app/login.tsx`"] },
      { type: "p", text: "普通一行" },
    ]);
    expect(markdownInlines(blocks[1].type === "ul" ? blocks[1].items[0] : "")).toEqual([
      { type: "strong", text: "登录" },
      { type: "text", text: " · " },
      { type: "code", text: "/login" },
      { type: "text", text: " · " },
      { type: "code", text: "apps/mobile/app/login.tsx" },
    ]);
  });
});
