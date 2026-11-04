type Props = {
  imageSrc: string;
  title: string;
  description: string;
  action?: React.ReactNode;
};

export function EmptyState({ imageSrc, title, description, action }: Props) {
  return (
    <div className="bb-card bb-empty-rich">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt=""
        width={420}
        height={236}
        className="bb-empty-art"
      />
      <h2 className="bb-empty-title">{title}</h2>
      <p className="bb-muted bb-empty-desc">{description}</p>
      {action ? <div className="bb-empty-action">{action}</div> : null}
    </div>
  );
}
