import { describe, expect, it } from "vitest";
import { askImageNameOk, askImageToken, askImageTokenOk, takeAskImages } from "../src/lib/ask-images";

describe("ask images", () => {
  it("accepts a matching token and keeps four screenshots", () => {
    const token = askImageToken("whsec_test", 4, "abcd1234abcd.png");
    expect(askImageTokenOk("whsec_test", 4, "abcd1234abcd.png", token)).toBe(true);
    expect(askImageTokenOk("whsec_test", 4, "abcd1234abcd.png", "nope")).toBe(false);
    expect(askImageNameOk("../secret.png")).toBe(false);
    const taken = takeAskImages([
      { filename: "a.png", buffer: Buffer.from("1") },
      { filename: "b.jpg", buffer: Buffer.from("2") },
      { filename: "c.webp", buffer: Buffer.from("3") },
      { filename: "d.gif", buffer: Buffer.from("4") },
      { filename: "e.png", buffer: Buffer.from("5") },
      { filename: "notes.txt", buffer: Buffer.from("6") },
    ]);
    expect(taken.kept).toHaveLength(4);
    expect(taken.omitted).toBe(true);
  });
});