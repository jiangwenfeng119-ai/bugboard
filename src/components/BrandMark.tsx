export function BrandMark({
  size = 28,
  decorative = true,
}: {
  size?: number;
  /** 旁边已有「Bugboard」文案时作装饰图；单独使用时关闭并提供可访问名称 */
  decorative?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/mark.svg"
      alt={decorative ? "" : "Bugboard"}
      width={size}
      height={size}
      className="bb-brand-mark"
      aria-hidden={decorative || undefined}
    />
  );
}
