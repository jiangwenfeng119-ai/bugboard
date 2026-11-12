export const BUG_BODY_TEMPLATE = "## 环境\n\n## 复现步骤\n1. \n\n## 期望\n\n## 实际";

export function bugBodyUntouched(value: string) {
  const norm = (text: string) => text.replace(/\r\n/g, "\n").trim();
  return norm(value) === "" || norm(value) === norm(BUG_BODY_TEMPLATE);
}
