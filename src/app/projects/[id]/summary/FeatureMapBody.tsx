import { answerPieces } from "@/lib/ask-core";
import { markdownBlocks, markdownInlines } from "@/lib/markdown-lite";

export function FeatureMapBody({
  body,
  githubUrl,
  branch,
}: {
  body: string;
  githubUrl: string;
  branch: string;
}) {
  return (
    <div className="bb-feature-map">
      {markdownBlocks(body).map((block, index) => {
        if (block.type === "h") {
          return (
            <h3 key={index}>
              <Inline text={block.text} githubUrl={githubUrl} branch={branch} />
            </h3>
          );
        }
        if (block.type === "ul" || block.type === "ol") {
          const Tag = block.type === "ul" ? "ul" : "ol";
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} githubUrl={githubUrl} branch={branch} />
                </li>
              ))}
            </Tag>
          );
        }
        if (block.type === "pre") {
          return (
            <pre key={index}>
              <code>{block.text}</code>
            </pre>
          );
        }
        return (
          <p key={index}>
            <Inline text={block.text} githubUrl={githubUrl} branch={branch} />
          </p>
        );
      })}
    </div>
  );
}

function Inline({
  text,
  githubUrl,
  branch,
}: {
  text: string;
  githubUrl: string;
  branch: string;
}) {
  return markdownInlines(text).map((node, index) => {
    if (node.type === "code") {
      const href = fileHref(node.text, githubUrl, branch);
      const code = <code>{node.text}</code>;
      return href ? (
        <a key={index} className="bb-ask-link" href={href} target="_blank" rel="noreferrer">
          {code}
        </a>
      ) : (
        <code key={index}>{node.text}</code>
      );
    }
    if (node.type === "strong") return <strong key={index}>{node.text}</strong>;
    if (node.type === "link") {
      return (
        <a key={index} className="bb-ask-link" href={node.href} target="_blank" rel="noreferrer">
          {node.text}
        </a>
      );
    }
    return <TextWithPaths key={index} text={node.text} githubUrl={githubUrl} branch={branch} />;
  });
}

function TextWithPaths({
  text,
  githubUrl,
  branch,
}: {
  text: string;
  githubUrl: string;
  branch: string;
}) {
  return answerPieces(text, githubUrl, branch).map((piece, index) =>
    piece.href ? (
      <a key={index} className="bb-ask-link" href={piece.href} target="_blank" rel="noreferrer">
        {piece.text}
      </a>
    ) : (
      <span key={index}>{piece.text}</span>
    )
  );
}

function fileHref(text: string, githubUrl: string, branch: string) {
  const pieces = answerPieces(` ${text}`, githubUrl, branch);
  return pieces.find((piece) => piece.text === text && piece.href)?.href;
}
