import { parseProse, type Inline } from "@/lib/prose";

function InlineRun({ items }: { items: Inline[] }) {
  return items.map((item, index) => {
    if (item.type === "strong") return <strong key={index}>{item.text}</strong>;
    if (item.type === "code") return <code key={index}>{item.text}</code>;
    if (item.type === "link") {
      return (
        <a key={index} href={item.href} target="_blank" rel="noreferrer">
          {item.text}
        </a>
      );
    }
    return <span key={index}>{item.text}</span>;
  });
}

export function Prose({ text, empty }: { text: string; empty?: string }) {
  const blocks = parseProse(text);
  if (blocks.length === 0) {
    return empty ? <p className="bb-muted bb-prose-empty">{empty}</p> : null;
  }

  return (
    <div className="bb-prose">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h3 key={index}>
              <InlineRun items={block.inlines} />
            </h3>
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineRun items={item} />
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                <InlineRun items={line} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
