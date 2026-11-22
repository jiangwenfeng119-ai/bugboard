import { describe, expect, it } from "vitest";
import { joinAskSpeech } from "../src/components/live-speech";

describe("joinAskSpeech", () => {
  it("keeps committed text when the interim transcript goes empty", () => {
    expect(joinAskSpeech("会员积分在哪里", "")).toBe("会员积分在哪里");
    expect(joinAskSpeech("会员积分在哪里", "呢")).toBe("会员积分在哪里呢");
  });

  it("keeps typed text and appends finals without wiping on silence", () => {
    expect(joinAskSpeech("先问一下：", "入口在哪")).toBe("先问一下：入口在哪");
    expect(joinAskSpeech("先问一下：入口在哪", "")).toBe("先问一下：入口在哪");
  });

  it("adds a space only between Latin chunks", () => {
    expect(joinAskSpeech("where is", "the door")).toBe("where is the door");
  });
});
