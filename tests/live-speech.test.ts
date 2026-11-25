import { describe, expect, it } from "vitest";
import { joinAskSpeech, tidyAskSpeech } from "../src/components/live-speech";

describe("tidyAskSpeech", () => {
  it("removes spaces the browser puts between Chinese characters", () => {
    expect(tidyAskSpeech("听 得 到 吗 你 在 做 什 么")).toBe("听得到吗你在做什么");
    expect(tidyAskSpeech("这个 文字 它是 中间 都有 空 的 呀")).toBe("这个文字它是中间都有空的呀");
  });

  it("keeps normal spaces around Latin words", () => {
    expect(tidyAskSpeech("打开 Dashboard 页面")).toBe("打开 Dashboard 页面");
    expect(tidyAskSpeech("where is the door")).toBe("where is the door");
  });
});

describe("joinAskSpeech", () => {
  it("keeps committed text when the interim transcript goes empty", () => {
    expect(joinAskSpeech("会员积分在哪里", "")).toBe("会员积分在哪里");
    expect(joinAskSpeech("会员积分在哪里", "呢")).toBe("会员积分在哪里呢");
  });

  it("keeps typed text and appends finals without wiping on silence", () => {
    expect(joinAskSpeech("先问一下：", "入口在哪")).toBe("先问一下：入口在哪");
    expect(joinAskSpeech("先问一下：入口在哪", "")).toBe("先问一下：入口在哪");
  });

  it("replaces a soft-committed interim prefix when the final is longer", () => {
    expect(joinAskSpeech("问：会员", "会员积分")).toBe("问：会员积分");
    expect(joinAskSpeech("会员", "会员积分在哪里")).toBe("会员积分在哪里");
  });

  it("adds a space only between Latin chunks", () => {
    expect(joinAskSpeech("where is", "the door")).toBe("where is the door");
  });

  it("tidies spaced Chinese pieces before merging", () => {
    expect(joinAskSpeech("听 得 到 吗", "你 在 做 什 么")).toBe("听得到吗你在做什么");
  });
});
