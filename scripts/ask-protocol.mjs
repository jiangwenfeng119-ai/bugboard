import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WRITE_NAME = /write|delete|strreplace|applypatch|editnotebook|search_replace|edit_file/i;
const MUTATING_SHELL =
  /(^|&&|\|\||[;&|])\s*(rm|mv|tee|chmod|chown|dd|truncate|mkdir|rmdir|touch|cp|install|ln|unlink)\b|(?:^|[^&0-9])>>?\s*\S|git\s+(commit|push|reset|checkout|clean|add|merge|rebase|switch)|sed\s+-[^\n]*\bi\b/i;

export function usableAskSession(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!/^[\w.][\w.-]{0,199}$/.test(id)) return "";
  return id;
}

export function assertCloneUrl(url) {
  const value = String(url || "").trim();
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value)) return value;
  if (/^git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?$/.test(value)) return value;
  return "";
}

export function assertAskBranch(value) {
  const branch = String(value || "").trim();
  if (!branch) return "";
  if (!/^[\w][\w./-]{0,118}$/.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.endsWith(".")) {
    throw new Error("默认分支无效");
  }
  return branch;
}

function canonicalRemote(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const ssh = value.match(/^git@([^:/\s]+):([^/\s].*)$/i);
  if (ssh) {
    const host = ssh[1].toLowerCase();
    const pathName = ssh[2].replace(/\.git$/i, "").replace(/\/+$/, "").replace(/^\/+/, "");
    return `${host}/${pathName}`.toLowerCase();
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const pathName = url.pathname.replace(/\.git$/i, "").replace(/\/+$/, "").replace(/^\/+/, "");
    return `${url.hostname.toLowerCase()}/${pathName}`.toLowerCase();
  } catch {
    return "";
  }
}

export function askOriginsMatch(originUrl, githubUrl) {
  const origin = canonicalRemote(originUrl);
  const github = canonicalRemote(githubUrl);
  return Boolean(origin) && origin === github;
}

export function planAskMirror(input) {
  const url = assertCloneUrl(input.githubUrl);
  let branch = "";
  try {
    branch = assertAskBranch(input.defaultBranch);
  } catch (error) {
    return { action: "refuse", reason: error instanceof Error ? error.message : "默认分支无效" };
  }
  if (!String(input.githubUrl || "").trim()) {
    return { action: "refuse", reason: "这个项目还没有代码仓，请直接写报障" };
  }
  if (!url) return { action: "refuse", reason: "代码仓地址无效" };
  if (!input.exists) return { action: "clone", url, branch };
  if (!input.isGit) return { action: "refuse", reason: "问答目录不是 git 仓库" };
  if (!askOriginsMatch(input.originUrl, url)) {
    return { action: "refuse", reason: "问答目录的 origin 和代码仓不一致" };
  }
  const head = String(input.headBranch || "").trim();
  const target = branch || head;
  if (!target) return { action: "refuse", reason: "项目没有默认分支" };
  if (input.dirty || input.ahead > 0 || (branch && head && head !== branch)) {
    return { action: "reset", branch: target };
  }
  if (input.behind > 0) return { action: "ff", branch: target };
  return { action: "ready", branch: target };
}

export function cloneUrlForMachine(url) {
  return String(url || "").replace(/^https:\/\/github\.com\//, "git@github.com:");
}

export function askGitSteps(plan, dir, askRoot) {
  if (plan.action === "clone") {
    const args = ["clone", "--single-branch"];
    if (plan.branch) args.push("--branch", plan.branch);
    args.push(cloneUrlForMachine(plan.url), dir);
    return [{ cwd: askRoot, args }];
  }
  if (plan.action === "ff") {
    return [
      { cwd: dir, args: ["fetch", "origin"] },
      { cwd: dir, args: ["pull", "--ff-only", "origin", plan.branch] },
    ];
  }
  if (plan.action === "reset") {
    const remote = `origin/${plan.branch}`;
    return [
      { cwd: dir, args: ["fetch", "origin"] },
      { cwd: dir, args: ["checkout", "-B", plan.branch, remote] },
      { cwd: dir, args: ["reset", "--hard", remote] },
      { cwd: dir, args: ["clean", "-fd"] },
    ];
  }
  return [];
}

const ASK_CUT = /在哪里|在哪|是什么|怎么|如何|有没有|是否|请问|能不能|可以吗|为什么|什么原因/;
const ASK_SPLIT = /[啊呢吧吗呀？?！!。，,、\s的里并后和与或把被让给从到]+/;
const ASK_EDGE = /^(请|帮我|希望|目前|现在|这个|那个|一个|我们|你们|他们)+|(生成|之后|之前|里面|当中|相关|问题|优化|修改|显示|无法|不能|没有|一下)+$/g;
const DEFECT = /停了|中止|没有反应|没反应|无反应|闪退|白屏|丢失|不可用|无效|报错|无法|不能|不对|出错|失败|不显示|显示不全|错误|异常|冲突|卡顿|空白|空壳|算错|混乱|点了.{0,8}没/;
const VAGUE_PLACE = /^(页面|菜单|按钮|界面|功能|系统|登录|登陆|设置|问题|状态|动作|搜索|项目|密码|报告|中心|管理|字段)$/;
const GENERIC_LABEL = /^(中文|选择|创建|描述|内容|报障|标题|财务|商品|物流|客户|语言|确定|取消|保存|删除|编辑|返回|关闭|提交|新增|添加|修改|查看|详情|全部|更多|其他|提示|成功|失败|加载|暂无|当前|已经|可以|没有|确认|实际|系统)$/;
const LOGIN_HEAD = /^(退出|显示|选择|点击|直接|确认|修改|处理|修复|查询|移除|升级|进入|使用|打开|返回|关闭|取消|删除|新增|添加|所有|全部|其他|没有|一个|这个|那个)$/;
const FEATURE_WORD =
  "管理|开单|中心|清单|服务|入库|盘点|物流|看板|打卡|流水|培训|工资|资讯|拓扑|检索|告警|资产|手册|审批|调货|调拨|鉴定|赠品|收支|结算|罗盘|监控|驾驶|舱|仓|报告|台账|菜单|采购|录音|纪要|架构|找货|估价|上架|寄卖|登录|登陆|后台|设置|关联|登记|周报|审计|申请|移库|草稿|密码|汇率|通知|收款|催收|邮件|发布|接单";
const SCREENISH = new RegExp(FEATURE_WORD);

export function isFeatureMapPrompt(prompt) {
  return String(prompt || "").includes("请根据当前默认分支列出功能模块和用户入口");
}

export function questionFromPrompt(prompt) {
  const matches = [...String(prompt || "").matchAll(/(?:^|\n)<question>\n([\s\S]*?)\n<\/question>/g)];
  return matches.length ? matches[matches.length - 1][1].trim() : "";
}

function sectionUntil(text, from, markers) {
  const ends = markers.map((marker) => text.indexOf(marker, from)).filter((index) => index >= 0);
  const end = ends.length ? Math.min(...ends) : from + 8000;
  return text.slice(from, end).trim();
}

export function documentsFromPrompt(prompt) {
  const text = String(prompt || "");
  const label = "项目上传的文档摘录：";
  const start = text.indexOf(label);
  if (start < 0) return "";
  return sectionUntil(text, start + label.length, [
    "\n功能地图在这个项目",
    "\n用户已经写在报障",
    "\n用户的问题在",
  ]);
}

export function featureMapFromPrompt(prompt) {
  const text = String(prompt || "");
  const label = "地图如下：\n";
  const start = text.indexOf(label);
  if (start < 0) return "";
  return sectionUntil(text, start + label.length, ["\n用户已经写在报障", "\n用户的问题在"]);
}

function placesIn(text) {
  const found = [];
  for (const match of String(text || "").matchAll(/界面|页面|板块|模块/g)) {
    const before = String(text || "").slice(Math.max(0, match.index - 10), match.index);
    const raw = before.match(/([\u4e00-\u9fff]{2,8})$/)?.[1] || "";
    const name = raw.replace(/^(但是|然后|之后|现在|这个|那个|在|的|了|并|和|与|把|将|从|到|却|还|已|经|中)+/, "");
    if (name.length >= 2 && name.length <= 8 && !found.includes(name)) found.push(name);
  }
  return found;
}

const FEATURE_AT = new RegExp(FEATURE_WORD, "g");

function featureWindows(text) {
  const found = [];
  const push = (slice) => {
    if (slice.length < 2 || slice.length > 8 || slice.includes("的") || !SCREENISH.test(slice) || found.includes(slice)) return;
    found.push(slice);
  };
  for (const run of String(text || "").match(/[\u4e00-\u9fff]{2,}/g) || []) {
    FEATURE_AT.lastIndex = 0;
    for (const match of run.matchAll(FEATURE_AT)) {
      const word = match[0];
      const start = match.index;
      push(word);
      if (start >= 2 && !/^[次一个下上前后这那]/.test(run.slice(start - 2, start))) push(run.slice(start - 2, start) + word);
      const rest = run.slice(start + word.length);
      const one = rest.slice(0, 1);
      const two = rest.slice(0, 2);
      if (/^[\u4e00-\u9fff]$/.test(one) && !/^[在哪里吗呢啊吧的了还是]$/.test(one)) push(word + one);
      if (/^[\u4e00-\u9fff]{2}$/.test(two) && SCREENISH.test(two)) {
        push(word + two);
        if (start >= 2) push(run.slice(start - 2, start) + word + two);
      }
    }
  }
  return found.filter((slice) => !found.some((other) => other.length > slice.length && other.includes(slice)));
}

export function askSearchTerms(question) {
  const head = String(question || "").split(ASK_CUT)[0];
  const terms = [];
  const push = (term) => {
    const clean = String(term || "").replace(ASK_EDGE, "");
    if (clean.length < 2 || clean.length > 8 || terms.includes(clean)) return;
    terms.push(clean);
  };
  for (const name of placesIn(question)) push(name);
  for (const name of featureWindows(question)) push(name);
  for (const piece of head.split(ASK_SPLIT)) {
    for (const chunk of piece.match(/[\u4e00-\u9fff]{2,8}/g) || []) push(chunk);
  }
  for (const word of String(question || "").match(/[A-Za-z][A-Za-z0-9_./-]{1,24}/g) || []) {
    if (!terms.includes(word)) terms.push(word);
  }
  return terms.slice(0, 8);
}

function newFeatureAnswer(question, place) {
  const where = place ? `在${place}` : "哪个页面";
  const confirmed = /已经和产品经理[\s\S]{0,12}确认|已经和\s*Marshal\s*确认|已经沟通确认/.test(question);
  if (confirmed) {
    return `现在没有。这是新功能。你已经写了和产品经理确认，报障里保留这句，系统可以按确认过的做法做。请写清：${where}希望怎样。`;
  }
  return `现在没有。这是新功能。请先和产品经理讨论。讨论确认后，在报障里写上「已经和产品经理沟通确认」。请写清：${where}希望怎样。`;
}

export function looksLikeDefect(question) {
  return DEFECT.test(String(question || ""));
}

export function chooseAskPath({ question, imageCount = 0 }) {
  const text = String(question || "");
  if (Number(imageCount) > 0) return "deep";
  if (/对照代码|对应代码/.test(text)) return "deep";
  if (looksLikeDefect(text)) return "deep";
  if (/应该[\s\S]{0,40}(却|但是|但)/.test(text)) return "deep";
  return "table";
}

export function askReplyGuide() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.cursor/skills/ask-before-report/SKILL.md");
  try {
    return fs.readFileSync(file, "utf8").replace(/^---[\s\S]*?---\s*/, "").trim();
  } catch {
    return "";
  }
}

export function appendDeepBrief({ prompt, tableAnswer, imagePaths, imagesOmitted }) {
  const lines = [
    String(prompt || "").trimEnd(),
    "",
    "这次只读当前工作区。它是问答镜像，不是开发目录。不要改文件，不要提交。",
    "先看附上的图片，再看相关页面的代码。按下面的确认规则作答。查表结果只供对照，以代码和图片为准。",
  ];
  const guide = askReplyGuide();
  if (guide && !String(prompt || "").includes("# 报障前确认")) lines.push("", guide);
  const table = String(tableAnswer || "").trim();
  if (table) lines.push("", "查表先找到这些，只供对照，以代码和图片为准：", table);
  const paths = (imagePaths || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (paths.length) lines.push("", "图片在工作区里，请打开这些文件看画面：", ...paths);
  if (imagesOmitted) lines.push("还有图片没能带上。");
  return lines.join("\n");
}

export function fallbackAskAnswer(tableAnswer) {
  const note = "代码对照没有在时限内完成。";
  const base = String(tableAnswer || "").trim();
  if (!base) return `${note}\n判断：没有把握`;
  if (base.includes(note)) return base;
  const lines = base.split("\n");
  const last = lines[lines.length - 1] || "";
  if (/^判断：/.test(last)) {
    lines.splice(lines.length - 1, 0, note);
    return lines.join("\n");
  }
  return `${base}\n${note}`;
}

export function phraseLabels(source) {
  const lines = [];
  const seen = new Set();
  const push = (name) => {
    const clean = String(name || "").trim();
    if (!clean || seen.has(clean) || VAGUE_PLACE.test(clean) || GENERIC_LABEL.test(clean)) return;
    if (!/^[\u4e00-\u9fff]{2,10}$/.test(clean) && clean !== "OCR") return;
    seen.add(clean);
    lines.push(`界面「${clean}」`);
  };
  const text = String(source || "");
  for (const match of text.matchAll(/\b[\w.]+\s*:\s*["']([\u4e00-\u9fff]{5,10})["']/g)) push(match[1]);
  for (const match of text.matchAll(/[（]([\u4e00-\u9fff]{2,4})[）]/g)) push(match[1]);
  for (const match of text.matchAll(/["']([\u4e00-\u9fff]{2,6})（[^"']{1,16}）["']/g)) push(match[1]);
  for (const match of text.matchAll(/\bzh:\s*['"]([^'"]{2,8})['"]/g)) {
    if (/(^|[^A-Za-z])OCR([^A-Za-z]|$)/.test(match[1])) push("OCR");
  }
  for (const match of text.matchAll(/\b(?:label|placeholder|aria-label)=["']([\u4e00-\u9fff]{2,8})["']/g)) push(match[1]);
  for (const match of text.matchAll(/Error\(\s*["']([\u4e00-\u9fff]{4,10})["']/g)) push(match[1]);
  if (text.includes("bb-project-card")) push("项目卡片");
  if (text.includes("内部共享")) push("内部共享");
  if (/\bCursor\b/.test(text) && !seen.has("Cursor")) {
    seen.add("Cursor");
    lines.push("界面「Cursor」");
  }
  if (/本机 Agent|云端 Agent/.test(text) && !seen.has("Agent")) {
    seen.add("Agent");
    lines.push("界面「Agent」");
  }
  if (/["']English["']/.test(text) && /简体中文|Italiano/.test(text) && !seen.has("English")) {
    seen.add("English");
    lines.push("界面「English」");
  }
  if (/["']Italiano["']/.test(text) && /简体中文|English/.test(text) && !seen.has("Italiano")) {
    seen.add("Italiano");
    lines.push("界面「Italiano」");
  }
  if (/["']登录["']/.test(text) && !seen.has("登录")) {
    seen.add("登录");
    lines.push("界面「登录」");
  }
  return lines.join("\n");
}

export function headingLabels(source) {
  const lines = [];
  const seen = new Set();
  const push = (name) => {
    const clean = String(name || "").trim();
    if (!/^[\u4e00-\u9fff]{2,8}$/.test(clean) || VAGUE_PLACE.test(clean) || GENERIC_LABEL.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    lines.push(`界面「${clean}」`);
  };
  for (const match of String(source || "").matchAll(/<h[1-3][^>]*>\s*([^<{]{2,16})\s*<\/h[1-3]>/g)) push(match[1]);
  for (const match of String(source || "").matchAll(/\blabel:\s*["']([\u4e00-\u9fff]{2,8})["']/g)) push(match[1]);
  return lines.join("\n");
}

export function screenLines(source) {
  const text = String(source || "");
  const messages = new Map();
  for (const match of text.matchAll(/(\w+)\s*:\s*\{[^{}]*?\bzh:\s*['"]([^'"]+)['"]/g)) {
    messages.set(match[1], match[2]);
  }
  const lines = [];
  const seen = new Set();
  const push = (name, route) => {
    const clean = String(name || "").split("·").pop().trim();
    if (clean.length < 2 || clean.length > 16 || /[{}$]/.test(clean)) return;
    const key = `${clean}|${route || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(route ? `界面「${clean}」（${route}）` : `界面「${clean}」`);
  };
  for (const match of text.matchAll(/['"](\/[a-z][a-z0-9/_-]*)['"]\s*:\s*\{[^{}]*?\bzh:\s*['"]([^'"]+)['"]/g)) {
    push(match[2], match[1]);
  }
  for (const block of text.split(/if\s*\(/)) {
    const route = block.match(/pathname\.startsWith\(['"]([^'"]+)['"]\)/);
    if (!route) continue;
    const picked = block.match(/pick\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
    const key = block.match(/UI_MESSAGES\.(\w+)/);
    push(picked?.[1] || (key ? messages.get(key[1]) : ""), route[1]);
  }
  for (const match of text.matchAll(/「([\u4e00-\u9fff]{2,8})」(?:里|界面|页面)/g)) {
    push(match[1], "");
  }
  for (const match of text.matchAll(/(?:^|[\s{,])[A-Za-z][\w.-]*\s*:\s*["']([A-Z][A-Za-z][A-Za-z0-9]{3,15})["']/g)) {
    push(match[1], "");
  }
  for (const match of text.matchAll(/["']([\u4e00-\u9fff]{2,8})["']\s*:\s*["']([^"'\n]{1,48})["']/g)) {
    if (/[\u4e00-\u9fff，。！？]/.test(match[2])) continue;
    if (SCREENISH.test(match[1]) || match[1].length >= 4) push(match[1], "");
    if (/^[A-Z][A-Za-z][A-Za-z0-9]{3,15}$/.test(match[2])) push(match[2], "");
  }
  for (const match of text.matchAll(/\bzh:\s*['"]([^'"]{4,16})['"]/g)) {
    if (/[，。！？]/.test(match[1])) continue;
    if (/^[\u4e00-\u9fff]{4,8}$/.test(match[1]) || (/^[\u4e00-\u9fff]{2,3}$/.test(match[1]) && SCREENISH.test(match[1]))) push(match[1], "");
    for (const name of featureWindows(match[1])) {
      if (name.length >= 2 && name.length <= 8) push(name, "");
    }
  }
  for (const match of text.matchAll(/(?:^|\\n)([\u4e00-\u9fff]{2,8})\|[^|\n]{1,24}\|(\/[a-z][a-z0-9/_-]*)/g)) {
    push(match[1], match[2]);
  }
  for (const match of text.matchAll(/(?:['"][\w.-]{2,}['"]|[\w.-]{2,})\s*:\s*['"]([^'"\n]{2,16})['"]/g)) {
    if (/[，。！？]/.test(match[1])) continue;
    if (/^[\u4e00-\u9fff]{4,8}$/.test(match[1]) || (/^[\u4e00-\u9fff]{2,3}$/.test(match[1]) && SCREENISH.test(match[1]))) push(match[1], "");
    for (const name of featureWindows(match[1])) {
      if (name.length >= 2 && name.length <= 8) push(name, "");
    }
  }
  return lines.join("\n");
}

export function collectAskHits(dir, terms, git) {
  if (!terms.length || typeof git !== "function") return [];
  const pattern = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const listed = git(dir, ["ls-files"]);
  const names = String(listed?.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && terms.some((term) => line.toLowerCase().includes(term.toLowerCase())));
  const grepped = git(dir, ["grep", "-n", "-I", "-i", "-m", "3", "-E", pattern]);
  const hits = [];
  for (const name of names) hits.push({ path: name, line: "" });
  for (const line of String(grepped?.stdout || "").split("\n")) {
    const match = line.match(/^([^:]+):\d+:(.*)$/);
    if (!match) continue;
    hits.push({ path: match[1], line: match[2].trim().slice(0, 180) });
  }
  return hits.slice(0, 24);
}

function catalogLine(raw) {
  const text = String(raw || "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 500) return null;
  const routeOf = (route) => String(route || "").replace(/\/+$/, "");
  const screen = text.match(/^界面「([^」]{2,16})」(?:（(\/[a-z][a-z0-9/_-]*)）)?$/i);
  if (screen) {
    const route = routeOf(screen[2]);
    const name = screen[1].trim();
    return {
      kind: route ? "page" : "menu",
      name,
      route,
      detail: "",
      text: route ? `页面「${name}」（${route}）` : `应用里能看到「${name}」`,
    };
  }
  const table = text.match(/^\|?\s*(\/[a-z][a-z0-9/_-]*)\s*\|\s*([^|]{1,80})/i);
  if (table) {
    const detail = table[2].replace(/\*\*/g, "").trim();
    const name = detail.replace(/（.*$/, "").replace(/\(.*$/, "").trim();
    const route = routeOf(table[1]);
    if (name.length >= 2 && name.length <= 24 && route.length > 1) {
      return { kind: "page", name, route, detail, text: `页面「${name}」（${route}）` };
    }
  }
  const menuTable = text.match(/^\|\s*([\u4e00-\u9fffA-Za-z0-9·]{2,12})\s*\|\s*([^|]{2,80})/);
  if (menuTable && !/菜单|用来|说明|名称/.test(menuTable[1]) && !/^[-:：\s]+$/.test(menuTable[2])) {
    const name = menuTable[1].trim();
    const detail = menuTable[2].trim();
    return { kind: "menu", name, route: "", detail, text: `侧边栏「${name}」` };
  }
  const bullet = text.match(/^((?:[-*]\s*)?[^（(:：|]{2,22})（(\/[a-z][a-z0-9/_-]*)[^）]{0,16}）(?:[：:]\s*(.*))?/i);
  if (!bullet) return null;
  const name = bullet[1].replace(/^[#>*\-\s\d.]+/, "").trim();
  const route = routeOf(bullet[2]);
  if (name.length < 2 || name.length > 16 || route.length < 2) return null;
  return { kind: "menu", name, route, detail: String(bullet[3] || "").trim(), text: `侧边栏「${name}」（${route}）` };
}

function featureOverlaps(name, term) {
  const left = String(name || "");
  const right = String(term || "");
  if (left.length < 2 || right.length < 2) return false;
  const fold = (value) => value.replaceAll("登陆", "登录");
  if (left.includes(right) || right.includes(left) || fold(left).includes(fold(right)) || fold(right).includes(fold(left))) return true;
  const stem = (value) => value.replace(/(单|管理|审批|中心|页面|按钮)$/, "");
  const a = stem(left);
  const b = stem(right);
  return a.length >= 2 && a === b;
}

function entryLine(raw) {
  const clean = String(raw || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^>\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || clean.length > 220 || /^#+\s/.test(clean)) return "";
  const cue = /帮助|菜单|侧边栏/;
  const routePattern = /(?:^|[^A-Za-z0-9_])\/[a-z][a-z0-9/_-]*/i;
  if (!cue.test(clean) && !routePattern.test(clean)) return "";
  const start = clean.search(cue.test(clean) ? cue : routePattern);
  let slice = clean.slice(Math.max(0, start)).replace(/[。；].*$/, "").trim();
  const route = slice.match(/^(.*?(?:\/[a-z][a-z0-9/_-]*)[)）]?)/i);
  if (route && route[1].length >= 6 && route[1].length < slice.length) slice = route[1].trim();
  return slice.slice(0, 120);
}

function lineAnswersQuestion(line, terms) {
  const lower = line.toLowerCase();
  if (terms.some((term) => lower.includes(term.toLowerCase()))) return true;
  const aboutManual = terms.some((term) => term.includes("手册") || term.toLowerCase().includes("manual"));
  return aboutManual && /手册|帮助|manual/i.test(line);
}

export function draftAskAnswer({ question, documents, hits, excerpts, featureMap }) {
  const terms = askSearchTerms(question);
  const asked = String(question || "").trim().slice(0, 80) || "这个问题";
  if (/功能地图/.test(asked) && /哪里|在哪|哪儿|位置|怎么找|怎么看/.test(asked)) {
    return ["功能地图在这个项目的「汇总」页最下面。", "判断：已经有了"].join("\n");
  }
  const entries = [];
  const catalog = [];
  const sources = [];
  const pool = [featureMap, excerpts, documents, ...(hits || []).map((hit) => hit?.line)]
    .filter(Boolean)
    .join("\n");
  for (const raw of pool.split("\n")) {
    const item = catalogLine(raw);
    if (item && !catalog.some((have) => have.text === item.text)) catalog.push(item);
  }
  const sentence = String(question || "").split("。")[0];
  const inSentence = (term) => term.length >= 2 && sentence.includes(term);
  const detailPiece = (item) =>
    String(item.detail || "")
      .split(/[、，,；;（）()]/)
      .map((part) => part.trim())
      .find(
        (piece) =>
          piece.length >= 3 &&
          piece.length <= 12 &&
          sentence.includes(piece) &&
          (SCREENISH.test(piece) ||
            terms.some((term) => piece === term || (term.length >= 3 && piece.includes(term)))),
      ) || "";
  const named = [];
  const exactNamed = catalog.some((item) => sentence.includes(item.name) && !VAGUE_PLACE.test(item.name) && !GENERIC_LABEL.test(item.name));
  for (const item of catalog) {
    const bare = !item.route && !item.detail && item.name.length >= 3 && SCREENISH.test(item.name) && sentence.includes(item.name);
    const login = !exactNamed && /^([\u4e00-\u9fff]{2,4})登录$/.exec(item.name);
    const loginHead = login && !LOGIN_HEAD.test(login[1]) && sentence.includes(login[1]) ? login[1] : "";
    const nameTerm = loginHead ||
      terms
        .filter(
          (term) =>
            inSentence(term) &&
            term.length >= 2 &&
            item.name.startsWith(term) &&
            item.name.length - term.length <= 4,
        )
        .sort((a, b) => b.length - a.length)[0] || "";
    const piece = detailPiece(item);
    const loginPage =
      (item.name === "登录" || item.name === "登陆") && sentence.includes("登陆页")
        ? "登陆页"
        : (item.name === "登录" || item.name === "登陆") && sentence.includes("登录页")
          ? "登录页"
          : "";
    const shared = item.name === "内部共享" && sentence.includes("商品共享") ? "商品共享" : "";
    const language =
      item.name === "English" && sentence.includes("英文")
        ? "英文"
        : item.name === "Italiano" && sentence.includes("意大利语")
          ? "意大利语"
          : "";
    const latinTarget = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const spelled =
      latinTarget.length >= 5 && /[A-Za-z]/.test(item.name) && !/[\u4e00-\u9fff]/.test(item.name)
        ? (sentence.match(/[A-Za-z][A-Za-z0-9]*(?:[\s_-]+[A-Za-z0-9]+)*/g) || []).find(
            (span) => span.toLowerCase().replace(/[^a-z0-9]/g, "") === latinTarget,
          ) || ""
        : "";
    const because = loginPage || shared || language || spelled || (bare ? item.name : sentence.includes(item.name) ? item.name : nameTerm || piece);
    if (!because || !sentence.includes(because)) continue;
    const shorter = sentence.includes(item.name)
      ? []
      : catalog
          .filter((other) => other.route && other.route === item.route && other.name.length < item.name.length)
          .sort((a, b) => a.name.length - b.name.length || (a.kind === "menu" ? -1 : 1));
    const chosen = shorter[0] || item;
    chosen.because = because;
    chosen.alias = Boolean(shorter[0] && shorter[0] !== item);
    chosen.viaDetail = Boolean(piece) && !sentence.includes(item.name);
    chosen.quote =
      loginPage ||
      shared ||
      language ||
      spelled ||
      (!chosen.detail && !sentence.includes(chosen.name) && sentence.includes(because) && (because.length >= 4 || because === loginHead)
        ? because
        : "");
    const sameRoute = chosen.route ? named.findIndex((have) => have.route === chosen.route) : -1;
    if (sameRoute >= 0) {
      const existing = named[sameRoute];
      if (sentence.includes(chosen.name) && chosen.name.length > existing.name.length) named[sameRoute] = chosen;
      continue;
    }
    if (named.some((have) => have.name === chosen.name)) continue;
    named.push(chosen);
  }
  const compact = named.filter(
    (item) =>
      !named.some(
        (other) =>
          other.name !== item.name &&
          sentence.includes(other.name) &&
          other.name.includes(item.name) &&
          other.name.length > item.name.length,
      ),
  );
  named.length = 0;
  named.push(...compact);
  for (const raw of pool.split("\n")) {
    const line = entryLine(raw);
    if (!line || !lineAnswersQuestion(line, terms) || entries.includes(line)) continue;
    const grounded = terms.some(
      (term) =>
        term.length >= 3 &&
        sentence.includes(term) &&
        (line.includes(term) || ((term.includes("手册") || term.toLowerCase().includes("manual")) && /手册|manual/i.test(line))),
    );
    if (!grounded) continue;
    entries.push(line);
  }
  const whereAsked = /在哪里|在哪|怎么找|怎么看|怎么进|哪儿/.test(question);
  const usefulLine = (line) => {
    const names = [...String(line).matchAll(/「([^」]{2,16})」/g)].map((match) => match[1]);
    if (!names.length) return true;
    if (names.some((name) => !VAGUE_PLACE.test(name))) return true;
    return names.some((name) => name === "登录" || name === "登陆") && /登录后|登陆后|登陆页|登录页|无法进入/.test(sentence);
  };
  const finish = (lines) => {
    const concrete = lines.filter(usefulLine);
    const quotes = [...concrete.join("").matchAll(/「([^」]{2,16})」/g)].map((match) => match[1]);
    const screenQuotes = quotes.filter((name) => SCREENISH.test(name));
    const placeName =
      (screenQuotes.length ? screenQuotes : quotes).sort(
        (a, b) => b.length - a.length || sentence.indexOf(a) - sentence.indexOf(b),
      )[0] || "";
    const place = (placeName === "登录" || placeName === "登陆") && sentence.includes("登陆页") ? "登陆页" : placeName;
    const spokenLines =
      place === "登陆页"
        ? concrete.map((line) => line.replaceAll("「登录」", "「登陆页」").replaceAll("「登陆」", "「登陆页」"))
        : concrete;
    const asksForNew = /增加|新增|加一个|新功能|功能扩展|应做|应该有|希望能|希望增加|希望有|能否|可以吗/.test(question);
    if (whereAsked && !looksLikeDefect(question) && !asksForNew) {
      if (!spokenLines.length) return "还确认不了。请补充：哪个页面、做了什么、实际怎样。\n判断：没有把握";
      return ["现在可以这样做：", ...spokenLines, "判断：已经有了"].join("\n");
    }
    if (asksForNew) {
      return [newFeatureAnswer(question, place), ...spokenLines, "判断：建议报障"].join("\n");
    }
    const hint = place
      ? `这需要报障。请写清：在${place}做了什么、实际怎样。`
      : "这需要报障。请写清：哪个页面、做了什么、实际怎样。";
    return [hint, ...spokenLines, "判断：建议报障"].join("\n");
  };
  const phrase = (item) => {
    const quoted = item.quote ? item.text.replaceAll(`「${item.name}」`, `「${item.quote}」`) : item.text;
    const inName = terms.some((term) => featureOverlaps(item.name, term) && item.name.includes(term.slice(0, 2)));
    if (inName || !item.detail) return quoted;
    const term = terms.find((itemTerm) => item.detail.includes(itemTerm) || featureOverlaps(item.detail, itemTerm));
    const clause = String(item.detail || "")
      .split(/[、，,；;]/)
      .map((part) => part.trim())
      .find((part) => term && (part.includes(term) || featureOverlaps(part, term)));
    const spoken = String(item.detail || "")
      .split(/[、，,；;（）()]/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && part.length <= 12 && sentence.includes(part))
      .sort((a, b) => b.length - a.length)[0];
    if (spoken && spoken !== item.name) return `${quoted}，其中有${spoken}`.slice(0, 140);
    if (!clause || clause === item.name) return quoted;
    return `${quoted}，其中有${clause}`.slice(0, 140);
  };
  const aboutManual = terms.some((term) => term.includes("手册") || term.toLowerCase().includes("manual"));
  const strong = entries.filter((line) => /手册|manual/i.test(line) && /\/[a-z]/i.test(line));
  if (aboutManual && strong.length) return finish([strong[0]]);
  if (named.length) {
    named.sort((a, b) => {
      const rank = (item) => {
        const index = sentence.indexOf(item.name);
        if (index >= 0) return index;
        const via = sentence.indexOf(item.because || "");
        return via >= 0 ? via + 20 : 100;
      };
      const routed = (item) => (item.route ? 0 : 1);
      const screenRank = (item) => (VAGUE_PLACE.test(item.quote || item.name) ? 2 : SCREENISH.test(item.name) ? 0 : 1);
      return screenRank(a) - screenRank(b) || b.name.length - a.name.length || rank(a) - rank(b) || routed(a) - routed(b);
    });
    const focused = named.filter(
      (item) =>
        sentence.includes(item.name) ||
        (item.quote && sentence.includes(item.quote)) ||
        (item.alias && item.because && sentence.includes(item.because)) ||
        (item.viaDetail && item.because && sentence.includes(item.because)),
    );
    const exact = focused.filter((item) => sentence.includes(item.name) && !VAGUE_PLACE.test(item.name));
    const picked = exact.length ? exact : focused;
    const shown = [];
    const menu = picked.find((item) => item.kind === "menu");
    if (menu) shown.push(phrase(menu));
    for (const item of picked) {
      if (item.kind !== "page" || shown.some((line) => line.includes(item.name))) continue;
      shown.push(phrase(item));
      if (shown.length >= 2) break;
    }
    if (shown.length) return finish(shown.slice(0, 2));
  }
  const shown = (strong.length ? strong : entries).slice(0, strong.length ? 1 : 2);
  for (const hit of hits || []) {
    const pathName = String(hit?.path || "").replace(/\\/g, "/").trim();
    if (/\.md$/i.test(pathName) && !pathName.includes("..") && !sources.includes(pathName)) sources.push(pathName);
  }
  if (shown.length) return finish(shown);
  const places = placesIn(sentence).filter((name) => SCREENISH.test(name) && !VAGUE_PLACE.test(name));
  const spoken = featureWindows(sentence)
    .map((name) => name.replace(/^(选择|点击|直接|放到|进入|使用|打开|新增|增加|没有|不能|无法)/, ""))
    .filter((name) => name.length >= 4 && sentence.includes(name) && !VAGUE_PLACE.test(name))
    .sort((a, b) => b.length - a.length)[0] || "";
  const said = spoken.length >= (places[0] || "").length ? spoken : places[0];
  if (said && !(whereAsked && !looksLikeDefect(question))) return finish([`你说的是「${said}」。`]);
  if (!whereAsked && /增加|新增|加一个|新功能|功能扩展|应做|应该有|希望能|希望增加|希望有|能否|可以吗/.test(question)) {
    return `${newFeatureAnswer(question, "")}\n判断：建议报障`;
  }
  if (looksLikeDefect(question)) return "这需要报障。请写清：哪个页面、做了什么、实际怎样。\n判断：建议报障";
  if (sources.length && whereAsked) return `文档里提到这件事，但没有写清在应用的哪个菜单或页面进入。\n判断：没有把握`;
  if (!whereAsked && (sources.length || /优化|希望|应该/.test(question))) {
    return "这需要报障。请写清：哪个页面、做了什么、你希望怎样。\n判断：建议报障";
  }
  return "还确认不了。请补充：哪个页面、做了什么、实际怎样。\n判断：没有把握";
}

export function buildAskArgv({ cwd, prompt, sessionId }) {
  const args = [
    "agent",
    "-p",
    "--mode",
    "ask",
    "--sandbox",
    "enabled",
    "--trust",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--workspace",
    cwd,
  ];
  const session = usableAskSession(sessionId);
  if (session) args.splice(2, 0, "--resume", session);
  args.push(prompt);
  return args.filter((part) => part !== "--force" && part !== "--yolo" && part !== "-f" && part !== "--approve-mcps");
}

export function askEnv(base) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith("BUGBOARD_") || key === "WAKE_SECRET") delete env[key];
  }
  return env;
}

export function callbackAllowed(callbackUrl, bugboardUrl) {
  let url;
  try {
    url = new URL(String(callbackUrl || ""));
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.pathname !== "/api/ask/callback") return false;
  if (url.username || url.password) return false;
  const base = String(bugboardUrl || "").trim();
  if (!base) {
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  }
  try {
    return url.origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function findTool(data) {
  const call = data.tool_call || data.toolCall;
  if (call && typeof call === "object") {
    if (typeof call.name === "string") {
      return {
        name: call.name,
        path: stringValue(call.args?.path || call.args?.file_path || call.args?.target_file),
        command: stringValue(call.args?.command),
      };
    }
    for (const [key, value] of Object.entries(call)) {
      if (!value || typeof value !== "object") continue;
      const args = value.args && typeof value.args === "object" ? value.args : value;
      return {
        name: key,
        path: stringValue(args.path || args.file_path || args.target_file),
        command: stringValue(args.command),
      };
    }
  }
  if (data.type === "tool_use" || data.type === "tool_call") {
    return {
      name: stringValue(data.name),
      path: stringValue(data.input?.path || data.input?.file_path),
      command: stringValue(data.input?.command),
    };
  }
  return null;
}

function extractText(data) {
  if (typeof data.text === "string" && (data.type === "text" || data.type === "delta" || data.type === "assistant")) {
    return data.text;
  }
  const content = data.message?.content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => item && item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
  }
  if (typeof data.delta === "string") return data.delta;
  if (typeof data.delta?.text === "string") return data.delta.text;
  return "";
}

function statusPath(filePath) {
  const text = String(filePath || "").replace(/\\/g, "/");
  if (!text || text.length > 180 || /(^|\/)\.env|id_rsa|credentials|secret/i.test(text)) return "正在查看代码";
  const relative = text.includes("/src/") ? text.slice(text.indexOf("/src/") + 1) : text.split("/").slice(-3).join("/");
  return `正在查看 ${relative}`.slice(0, 240);
}

export function parseAskStreamLine(line) {
  const raw = String(line || "").trim();
  if (!raw.startsWith("{")) return { kind: "ignore" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "ignore" };
  }
  if (!data || typeof data !== "object") return { kind: "ignore" };
  const sessionId = usableAskSession(data.session_id || data.sessionId || "");
  const tool = findTool(data);
  if (tool) {
    const shell = /shell|bash|command/i.test(tool.name);
    if ((WRITE_NAME.test(tool.name) && !/read/i.test(tool.name)) || (shell && MUTATING_SHELL.test(tool.command))) {
      return { kind: "write", name: tool.name, command: tool.command };
    }
    return { kind: "status", text: statusPath(tool.path) };
  }
  if (data.type === "result" || data.type === "done") {
    return { kind: "result", text: typeof data.result === "string" ? data.result : "", sessionId };
  }
  const text = extractText(data);
  if (text) return { kind: "text", text, sessionId };
  if (sessionId) return { kind: "session", sessionId };
  return { kind: "ignore" };
}
