/**
 * Bugboard MCP tool server. stdio and the public HTTP endpoint both use this.
 * Tools call Bugboard REST with the API key supplied for this process or request.
 */
import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { agentFilesRoot, enrichBugDetail } from "./materialize";
import { projectWriteFields } from "./project-fields";

export function createBugboardMcpServer(options: {
  baseUrl: string;
  apiKey: string;
}) {
  const BASE = options.baseUrl.replace(/\/$/, "") || "http://127.0.0.1:3000";
  const KEY = options.apiKey;

async function api(
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  if (!KEY) throw new Error("BUGBOARD_API_KEY 未设置");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `HTTP ${res.status}`
    );
  }
  return data;
}

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errResult(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

async function downloadAttachment(id: number): Promise<Buffer> {
  if (!KEY) throw new Error("BUGBOARD_API_KEY 未设置");
  const res = await fetch(`${BASE}/api/attachments/${id}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const transitionNote = z.string().optional().describe("说明 / 修复说明 / 原因");

  const server = new McpServer({
  name: "bugboard",
  version: "0.1.0",
});

server.tool(
  "list_projects",
  "列出当前 Key 可见的项目。每条含 description（项目列表卡片上的说明），以及项目资料：product_manager、experience_officer、github_url、default_branch、tech_stack、design_url、docs_url、dev_url、test_url、prod_url、verify_env、agent_notes，以及 documents（设计稿和需求文档附件）",
  {},
  async () => {
    try {
      return textResult(await api("/api/projects"));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "get_project_stats",
  "获取项目汇总与趋势。含每日新建、各状态流入，以及按提报人、按处理人的每日计数",
  {
    projectId: z.number().int().positive().describe("项目 ID"),
    days: z
      .union([z.literal(7), z.literal(30), z.literal(90)])
      .optional()
      .describe("趋势窗口天数，默认 30"),
  },
  async ({ projectId, days }) => {
    try {
      return textResult(
        await api(`/api/projects/${projectId}/stats?days=${days || 30}`)
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "list_bugs",
  "列出项目内报障",
  {
    projectId: z.number().int().positive(),
    status: z
      .enum([
        "pending",
        "fixing",
        "needs_info",
        "awaiting_confirm",
        "confirmed",
        "invalid",
      ])
      .optional(),
    priority: z.enum(["p1", "p2", "p3"]).optional(),
    q: z.string().optional().describe("标题或报障 ID 关键词"),
  },
  async ({ projectId, status, priority, q }) => {
    try {
      const sp = new URLSearchParams();
      if (status) sp.set("status", status);
      if (priority) sp.set("priority", priority);
      if (q) sp.set("q", q);
      const qs = sp.toString();
      return textResult(
        await api(
          `/api/projects/${projectId}/bugs${qs ? `?${qs}` : ""}`
        )
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "get_bug",
  "获取报障详情（含时间线与可执行动作）。docx/txt 正文在 attachments[].text，文档内图片在 media，图片随结果返回。正文写「见附件」时以附件为准，没读完不要标不属实，也不要要求补充。",
  { bugId: z.number().int().positive() },
  async ({ bugId }) => {
    try {
      const detail = await api(`/api/bugs/${bugId}`);
      const { detail: enriched, images } = await enrichBugDetail(
        detail as {
          bug?: { id?: number };
          attachments?: { id: number; filename: string }[];
          events?: { attachments?: { id: number; filename: string }[] }[];
        },
        { root: agentFilesRoot(), download: downloadAttachment }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(enriched, null, 2) },
          ...images.flatMap((img) => [
            { type: "text" as const, text: img.label },
            {
              type: "image" as const,
              data: img.data,
              mimeType: img.mimeType,
            },
          ]),
        ],
      };
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "create_bug",
  "在项目中创建报障（测试 Agent / 用户级 Key）。截图先 stage_attachment，再把返回的 id 放进 attachmentIds。一条只写一个故障。",
  {
    projectId: z.number().int().positive(),
    title: z.string().min(1),
    body: z.string().optional(),
    priority: z.enum(["p1", "p2", "p3"]).optional().describe("默认 p2"),
    quote: z.string().optional().describe("报障人原话"),
    steps: z.array(z.string()).optional().describe("复现步骤"),
    evidenceSec: z.number().optional().describe("走查录像里的时间点，秒"),
    strokes: z
      .array(
        z.object({
          tool: z.enum(["free", "rect", "ellipse"]),
          points: z.array(z.object({ x: z.number(), y: z.number() })),
        })
      )
      .optional()
      .describe("圈选，坐标相对整张图，0 到 1"),
    openQuestion: z.string().optional().describe("还没确认的问题"),
    sourceUrl: z.string().optional().describe("页面地址"),
    confidence: z.enum(["low", "ok"]).optional(),
    attachmentIds: z.array(z.number().int().positive()).optional().describe("stage_attachment 返回的 id"),
  },
  async ({
    projectId,
    title,
    body,
    priority,
    quote,
    steps,
    evidenceSec,
    strokes,
    openQuestion,
    sourceUrl,
    confidence,
    attachmentIds,
  }) => {
    try {
      return textResult(
        await api(`/api/projects/${projectId}/bugs`, {
          method: "POST",
          body: JSON.stringify({
            title,
            body,
            priority: priority || "p2",
            quote,
            steps,
            evidenceSec,
            strokes,
            openQuestion,
            sourceUrl,
            confidence,
            attachmentIds,
          }),
        })
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "stage_attachment",
  "上传一张截图或附件，返回 id。随后在 create_bug 的 attachmentIds 里引用。只能引用自己上传的文件。单文件不超过 8MB。",
  {
    projectId: z.number().int().positive(),
    filename: z.string().min(1),
    dataBase64: z.string().min(1).describe("文件内容的 base64，不要带 data: 前缀"),
  },
  async ({ projectId, filename, dataBase64 }) => {
    try {
      const cleaned = dataBase64.replace(/^data:[^;]+;base64,/, "");
      const buf = Buffer.from(cleaned, "base64");
      if (!buf.length || buf.length > 8 * 1024 * 1024) throw new Error("附件大小无效");
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(buf)]), filename);
      return textResult(
        await api(`/api/projects/${projectId}/uploads`, { method: "POST", body: form })
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "list_captures",
  "列出项目里的走查。status=review 的还在等人看，不要把它当成已入库的报障。",
  { projectId: z.number().int().positive() },
  async ({ projectId }) => {
    try {
      return textResult(await api(`/api/projects/${projectId}/captures`));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "get_capture",
  "读取一次走查的转写和草稿。草稿里的 quote 是原话，steps 是步骤，frameUrl 要带着登录态打开。人还没在网页里点完成之前，不要创建报障。",
  {
    projectId: z.number().int().positive(),
    sessionId: z.number().int().positive(),
  },
  async ({ projectId, sessionId }) => {
    try {
      return textResult(await api(`/api/projects/${projectId}/captures/${sessionId}`));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "update_capture_drafts",
  "修改走查草稿的标题、正文、原话和步骤。status 仍由网页上的人决定。不要把草稿直接建成报障。",
  {
    projectId: z.number().int().positive(),
    sessionId: z.number().int().positive(),
    drafts: z.array(
      z.object({
        id: z.number().int().positive(),
        title: z.string(),
        body: z.string().optional(),
        quote: z.string().optional(),
        steps: z.array(z.string()).optional(),
        question: z.string().optional(),
        status: z.enum(["draft", "kept", "discarded", "merged"]),
        mergedIntoId: z.number().int().positive().optional(),
      })
    ),
  },
  async ({ projectId, sessionId, drafts }) => {
    try {
      return textResult(
        await api(`/api/projects/${projectId}/captures/${sessionId}`, {
          method: "PUT",
          body: JSON.stringify({ drafts }),
        })
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

async function transition(
  action: string,
  bugId: number,
  note?: string
) {
  return api(`/api/bugs/${bugId}/transitions`, {
    method: "POST",
    body: JSON.stringify({ action, note }),
  });
}

server.tool(
  "start_fix",
  "接单：待处理 → 修复中（管理员级 Key）",
  { bugId: z.number().int().positive(), note: transitionNote },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("start_fix", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "submit_fix",
  "提交修复说明：修复中 → 待确认（管理员级 Key，note 必填）。说明写给报障人，用界面上能看到的话，不要写文件名、函数名或接口。",
  {
    bugId: z.number().int().positive(),
    note: z
      .string()
      .min(1)
      .describe(
        "给报障人的修复说明（必填）。分三段：原来的问题、现在的表现、请这样重测。用界面上的名称写他会看到什么，不要写文件名、函数名、接口或实现细节。"
      ),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("submit_fix", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "mark_invalid",
  "标为不属实（管理员级 Key，note 必填）。改产品、现象不存在、符合现有做法或重复时使用。报障里写明已经和产品经理或 Marshal 沟通确认的不要调用，应按确认过的需求改。没有确认的改产品，说明写现在的做法，并请报障人找产品经理。正文或附件还没读时不要调用。",
  {
    bugId: z.number().int().positive(),
    note: z
      .string()
      .min(1)
      .describe(
        "给报障人的不属实原因（必填）。写清实际做了什么、实际看到什么、为什么和报障对不上。不要写文件名、函数名、接口或实现细节。重复时写另一张单的编号和标题。"
      ),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("mark_invalid", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "request_info",
  "要求补充：待处理或修复中 → 待补充（管理员级 Key，note 必填）。只在缺的材料只在报障人手里时使用，例如账号、机型、崩溃记录、操作记录。附件还没读完、读失败，或报障已经写清只是还没定位到原因时不要调用。",
  {
    bugId: z.number().int().positive(),
    note: z
      .string()
      .min(1)
      .describe(
        "给报障人的补充要求（必填）。写清已经查过什么、还缺哪一份材料。不要写文件名、函数名、接口或实现细节。"
      ),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("request_info", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "reopen_invalid",
  "撤回不属实：不属实 → 待处理（管理员级 Key，note 必填）。用于收回判错的不属实，不能代替报障人提异议。",
  {
    bugId: z.number().int().positive(),
    note: z
      .string()
      .min(1)
      .describe("撤回原因（必填）。写清上次漏看或判错的是哪一处，不要只写「重新处理」。"),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("reopen_invalid", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "withdraw_fix",
  "撤回修复提交：待确认 → 修复中（管理员级 Key，note 必填）。修复说明交早或还要继续改时使用。不能用来确认已修复。",
  {
    bugId: z.number().int().positive(),
    note: z
      .string()
      .min(1)
      .describe(
        "撤回原因（必填）。写清为什么先收回，以及报障人能看到的哪一点还要再改。"
      ),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("withdraw_fix", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "confirm_fix",
  "确认已修复：待确认 → 已确认（仅原报障人 Key）",
  { bugId: z.number().int().positive(), note: transitionNote },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("confirm_fix", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "reject_fix",
  "仍有问题：待确认 → 待处理（仅原报障人 Key，note 必填）",
  {
    bugId: z.number().int().positive(),
    note: z.string().min(1).describe("仍有问题说明（必填）"),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("reject_fix", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "dispute_invalid",
  "对不属实提出异议：不属实 → 待处理（仅原报障人 Key，note 必填）",
  {
    bugId: z.number().int().positive(),
    note: z.string().min(1).describe("异议说明（必填）"),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("dispute_invalid", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "provide_info",
  "补充材料：待补充 → 待处理（仅原报障人 Key，note 必填）。把补上的步骤、记录或结果写进说明。",
  {
    bugId: z.number().int().positive(),
    note: z.string().min(1).describe("补充说明（必填）。写清补上了什么。"),
  },
  async ({ bugId, note }) => {
    try {
      return textResult(await transition("provide_info", bugId, note));
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "update_project_docs",
  "写入项目资料（仅管理员级 Key）：description（项目列表卡片上的说明）、product_manager、experience_officer、github_url、default_branch、tech_stack、design_url、docs_url、dev_url、test_url、prod_url、verify_env（dev、test、prod 或空字符串）、agent_notes。只改传入的字段。没有写明的人名、地址和说明不要编。修报障时不要调用，只有用户让你补项目资料时才用。",
  {
    projectId: z.number().int().positive(),
    ...projectWriteFields,
  },
  async ({ projectId, ...fields }) => {
    try {
      const patch: Record<string, string> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === "string") patch[key] = value;
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("没有要写入的字段");
      }
      return textResult(
        await api(`/api/projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "upload_project_document",
  "给项目的设计稿或需求文档上传附件（仅管理员级 Key）。path 是本机文件路径。接受图片、pdf、docx、xlsx、txt、md、zip 和音视频。用户能在项目详情里打开这些文件。修报障时不要调用。",
  {
    projectId: z.number().int().positive(),
    kind: z.enum(["design", "docs"]).describe("design 是设计稿，docs 是需求文档"),
    path: z.string().min(1).describe("要上传的本机文件绝对路径"),
  },
  async ({ projectId, kind, path: filePath }) => {
    try {
      const abs = path.resolve(filePath);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        throw new Error("找不到这个文件");
      }
      const buf = fs.readFileSync(abs);
      const form = new FormData();
      form.set("kind", kind);
      form.append("files", new Blob([new Uint8Array(buf)]), path.basename(abs));
      return textResult(
        await api(`/api/projects/${projectId}/documents`, {
          method: "POST",
          body: form,
        })
      );
    } catch (e) {
      return errResult(e);
    }
  }
);

server.tool(
  "remove_project_document",
  "删除项目资料里的一份设计稿或需求文档附件（仅管理员级 Key）。documentId 来自 list_projects 的 documents。修报障时不要调用。",
  {
    projectId: z.number().int().positive(),
    documentId: z.number().int().positive(),
  },
  async ({ projectId, documentId }) => {
    try {
      return textResult(
        await api(`/api/projects/${projectId}/documents/${documentId}`, {
          method: "DELETE",
        })
      );
    } catch (e) {
      return errResult(e);
    }
  }
);
  return server;
}
