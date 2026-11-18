import { describe, expect, it } from "vitest";
import { ASK_IMAGE_MAX_BYTES } from "../src/lib/ask-core";
import { askPasteName, filesFromClipboard, pickAskPictures } from "../src/lib/ask-paste";

function clip(file: File | null, type = file?.type || "", kind = "file") {
  return { kind, type, getAsFile: () => file };
}

describe("ask paste", () => {
  it("names a clipboard screenshot and keeps it under the four-image cap", () => {
    expect(askPasteName("image/jpeg", "", 0)).toBe("paste-1.jpg");
    expect(askPasteName("", "shot.PNG", 1)).toBe("paste-2.png");
    expect(askPasteName("image/heic", "photo.heic", 0)).toBe("");
    const png = new File([Uint8Array.from([1, 2, 3])], "image.png", { type: "image/png" });
    const text = new File([Uint8Array.from([4])], "note.txt", { type: "text/plain" });
    const taken = filesFromClipboard({
      items: [clip(null, "text/plain", "string"), clip(png), clip(text, "text/plain")],
    });
    expect(taken.files.map((file) => file.name)).toEqual(["paste-1.png"]);
    expect(taken.skipped).toBe(0);
    const huge = new File([new Uint8Array(ASK_IMAGE_MAX_BYTES + 1)], "big.png", { type: "image/png" });
    const overflow = filesFromClipboard({ items: [clip(png), clip(png), clip(png), clip(png), clip(huge)] }, 0);
    expect(overflow.files).toHaveLength(4);
    expect(overflow.skipped).toBe(1);
  });

  it("sends pasted screenshots before attachments already on the form", () => {
    const pasted = { file: { type: "image/png", size: 10, name: "paste-1.png" } };
    const attached = { file: { type: "image/jpeg", size: 10, name: "form.jpg" } };
    const extra = { file: { type: "application/pdf", size: 10, name: "note.pdf" } };
    const picked = pickAskPictures(
      [pasted, pasted, pasted, pasted],
      [attached, extra]
    );
    expect(picked.chosen).toHaveLength(4);
    expect(picked.chosen.every((item) => item.file.name.startsWith("paste"))).toBe(true);
    expect(picked.dropped).toBe(true);
  });
});