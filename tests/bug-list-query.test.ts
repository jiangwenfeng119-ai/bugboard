import { describe, expect, it } from "vitest";
import { BUG_BODY_TEMPLATE, bugBodyUntouched } from "../src/lib/bug-body";
import { bugListQuery, bugListQueryFromUnknown } from "../src/lib/bug-list-query";

describe("bug list return query", () => {
  it("keeps the status filter and drops anything else", () => {
    expect(
      bugListQueryFromUnknown("status=awaiting_confirm&priority=p2&next=/admin&sort=updated&dir=desc")
    ).toBe("status=awaiting_confirm&priority=p2&sort=updated&dir=desc");
    expect(bugListQueryFromUnknown("https://evil.example/?status=pending")).toBe("");
    expect(bugListQuery({ status: "nope", q: "  标题  " })).toBe("q=%E6%A0%87%E9%A2%98");
  });
});

describe("bug body template", () => {
  it("treats the starter text as untouched", () => {
    expect(bugBodyUntouched("")).toBe(true);
    expect(bugBodyUntouched(BUG_BODY_TEMPLATE)).toBe(true);
    expect(bugBodyUntouched(`${BUG_BODY_TEMPLATE}\n`)).toBe(true);
    expect(bugBodyUntouched("## 环境\n\n本地")).toBe(false);
  });
});
