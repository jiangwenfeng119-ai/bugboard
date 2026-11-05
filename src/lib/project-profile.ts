export type VerifyEnv = "" | "dev" | "test" | "prod";

export type ProjectProfile = {
  product_manager: string;
  experience_officer: string;
  github_url: string;
  default_branch: string;
  tech_stack: string;
  design_url: string;
  docs_url: string;
  dev_url: string;
  test_url: string;
  prod_url: string;
  verify_env: VerifyEnv;
  agent_notes: string;
};

export type ProfileFieldKey = keyof ProjectProfile;

type ProfileField = {
  key: ProfileFieldKey;
  label: string;
  hint: string;
  max: number;
  kind: "text" | "url" | "textarea" | "verify";
  wide?: boolean;
};

export const PROFILE_FIELDS: ProfileField[] = [
  {
    key: "product_manager",
    label: "产品经理",
    hint: "改产品时找这个人确认",
    max: 80,
    kind: "text",
  },
  {
    key: "experience_officer",
    label: "体验官",
    hint: "负责体验走查和验收的人",
    max: 80,
    kind: "text",
  },
  {
    key: "github_url",
    label: "GitHub 代码仓",
    hint: "Agent 改代码时以这个仓库为准",
    max: 500,
    kind: "url",
    wide: true,
  },
  {
    key: "default_branch",
    label: "默认分支",
    hint: "例如 main",
    max: 120,
    kind: "text",
  },
  {
    key: "tech_stack",
    label: "技术栈",
    hint: "例如 Next.js、Go、iOS",
    max: 160,
    kind: "text",
  },
  {
    key: "design_url",
    label: "设计稿",
    hint: "Figma 链接，或在下面上传设计稿。详情里可以打开。",
    max: 500,
    kind: "url",
    wide: true,
  },
  {
    key: "docs_url",
    label: "需求文档",
    hint: "文档链接，或在下面上传需求文档。详情里可以打开。",
    max: 500,
    kind: "url",
    wide: true,
  },
  {
    key: "dev_url",
    label: "开发环境",
    hint: "开发环境地址",
    max: 500,
    kind: "url",
    wide: true,
  },
  {
    key: "test_url",
    label: "测试环境",
    hint: "测试环境地址",
    max: 500,
    kind: "url",
    wide: true,
  },
  {
    key: "prod_url",
    label: "生产环境",
    hint: "生产环境地址",
    max: 500,
    kind: "url",
    wide: true,
  },
  {
    key: "verify_env",
    label: "默认验收环境",
    hint: "Agent 复现和验收时优先打开这个环境",
    max: 8,
    kind: "verify",
  },
  {
    key: "agent_notes",
    label: "给 Agent 的说明",
    hint: "怎么启动、测哪些范围、账号向谁要。不要写密码、Token 或密钥。",
    max: 2000,
    kind: "textarea",
    wide: true,
  },
];

export const PROFILE_GROUPS: { title: string; keys: ProfileFieldKey[] }[] = [
  { title: "负责人", keys: ["product_manager", "experience_officer"] },
  {
    title: "代码与文档",
    keys: ["github_url", "default_branch", "tech_stack", "design_url", "docs_url"],
  },
  { title: "环境", keys: ["dev_url", "test_url", "prod_url", "verify_env"] },
  { title: "给 Agent 的说明", keys: ["agent_notes"] },
];

export const VERIFY_ENV_OPTIONS: { value: VerifyEnv; label: string }[] = [
  { value: "", label: "未指定" },
  { value: "dev", label: "开发环境" },
  { value: "test", label: "测试环境" },
  { value: "prod", label: "生产环境" },
];

const FIELD_BY_KEY = Object.fromEntries(
  PROFILE_FIELDS.map((field) => [field.key, field])
) as Record<ProfileFieldKey, ProfileField>;

export function profileField(key: ProfileFieldKey) {
  return FIELD_BY_KEY[key];
}

export function emptyProfile(): ProjectProfile {
  return {
    product_manager: "",
    experience_officer: "",
    github_url: "",
    default_branch: "",
    tech_stack: "",
    design_url: "",
    docs_url: "",
    dev_url: "",
    test_url: "",
    prod_url: "",
    verify_env: "",
    agent_notes: "",
  };
}

export function profileFromRow(row: Partial<ProjectProfile> | null | undefined): ProjectProfile {
  const profile = emptyProfile();
  if (!row) return profile;
  for (const field of PROFILE_FIELDS) {
    const value = row[field.key];
    if (typeof value !== "string") continue;
    if (field.key === "verify_env") {
      profile.verify_env = isVerifyEnv(value) ? value : "";
      continue;
    }
    profile[field.key] = value;
  }
  return profile;
}

export function profileStamp(profile: ProjectProfile) {
  return PROFILE_FIELDS.map((field) => profile[field.key]).join("\n");
}

export function isVerifyEnv(value: string): value is VerifyEnv {
  return VERIFY_ENV_OPTIONS.some((option) => option.value === value);
}

export function verifyEnvLabel(value: string) {
  return VERIFY_ENV_OPTIONS.find((option) => option.value === value)?.label || "未指定";
}

export function profileHref(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

export function profilePatchFromBody(body: unknown): Partial<ProjectProfile> {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const patch: Partial<ProjectProfile> = {};
  for (const field of PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field.key)) continue;
    const value = record[field.key];
    if (typeof value !== "string") throw new Error(`${field.label}格式不对`);
    (patch as Record<string, string>)[field.key] = value;
  }
  return patch;
}

export function applyProfilePatch(
  existing: ProjectProfile,
  patch: Partial<Record<ProfileFieldKey, unknown>>
): ProjectProfile {
  const next = { ...existing };
  for (const field of PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field.key)) continue;
    const raw = patch[field.key];
    if (typeof raw !== "string") throw new Error(`${field.label}格式不对`);
    const value = raw.trim();
    if (value.length > field.max) {
      throw new Error(`${field.label}不能超过 ${field.max} 个字`);
    }
    if (field.key === "verify_env") {
      if (!isVerifyEnv(value)) throw new Error("默认验收环境无效");
      next.verify_env = value;
      continue;
    }
    next[field.key] = value;
  }
  return next;
}
