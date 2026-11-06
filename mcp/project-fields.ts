import { z } from "zod";

const clearable = (text: string) =>
  z.string().optional().describe(`${text}传空字符串可清空。`);

export const projectWriteFields = {
  description: clearable("项目说明，显示在项目列表卡片上。"),
  product_manager: clearable("产品经理。没有写明的人名不要填。"),
  experience_officer: clearable("体验官。没有写明的人名不要填。"),
  github_url: clearable("GitHub 代码仓地址。"),
  default_branch: clearable("默认分支，例如 main。"),
  tech_stack: clearable("技术栈，例如 Next.js、Go。"),
  design_url: clearable("设计稿链接。"),
  docs_url: clearable("需求文档链接。"),
  dev_url: clearable("开发环境地址。"),
  test_url: clearable("测试环境地址。"),
  prod_url: clearable("生产环境地址。"),
  verify_env: z
    .enum(["", "dev", "test", "prod"])
    .optional()
    .describe("默认验收环境。dev、test、prod，或空字符串表示未指定。"),
  agent_notes: clearable(
    "给 Agent 的说明：怎么启动、测哪些范围、账号向谁要。不要写密码、Token 或密钥。"
  ),
};
