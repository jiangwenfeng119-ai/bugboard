function projectFromDetail(detail: string) {
  const named = detail.match(/项目\s+([A-Z][A-Z0-9]{1,7})/);
  if (named?.[1]) return named[1];
  return "";
}

function forProject(detail: string) {
  const code = projectFromDetail(detail);
  return code ? `为 ${code} ` : "为该项目";
}

function withRaw(hint: string, detail: string) {
  if (!hint || hint === detail) return detail;
  return `${hint}。原始：${detail}`;
}

/** 分派失败/跳过：人话怎么修 + 保留原始 detail。 */
export function explainDispatchDetail(detail: string) {
  const text = String(detail || "").trim();
  if (!text) return "";

  if (
    text === "fetch failed" ||
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|AbortError|timeout/i.test(text)
  ) {
    return withRaw(
      "连不上这个地址（本机叫醒服务没在跑，或 Docker 要用 host.docker.internal）",
      text
    );
  }

  if (text === "没有可启动的本机 agent" || text.endsWith("没有可启动的本机 agent")) {
    return withRaw("本机收到了，但没有可启动的 Agent", text);
  }

  if (/没有配置.+本地目录|wake\.config\.json 的 projects/.test(text)) {
    return withRaw(
      `在本机 wake.config.json 的 projects 里${forProject(text)}写上代码仓的绝对路径，保存后重启叫醒服务`,
      text
    );
  }

  if (/工作目录不存在/.test(text)) {
    const code = projectFromDetail(text);
    return withRaw(
      code
        ? `检查 ${code} 在 wake.config.json 里对应的路径是否存在且可访问`
        : "检查 wake.config.json 里该项目对应的路径是否存在且可访问",
      text
    );
  }

  if (/工作目录不是文件夹/.test(text)) {
    const code = projectFromDetail(text);
    return withRaw(
      code
        ? `检查 ${code} 在 wake.config.json 里对应的路径是不是一个文件夹`
        : "检查 wake.config.json 里该项目对应的路径是不是一个文件夹",
      text
    );
  }

  if (/主目录或磁盘根目录/.test(text)) {
    const code = projectFromDetail(text);
    return withRaw(
      code
        ? `把 ${code} 的工作目录改成项目代码仓，不要用家目录或磁盘根`
        : "把工作目录改成项目代码仓，不要用家目录或磁盘根",
      text
    );
  }

  if (/叫醒密钥/.test(text)) {
    const code = projectFromDetail(text);
    return withRaw(
      code
        ? `${code} 的工作区不要放 wake.config.json，请改到专用的项目代码目录`
        : "工作区不要放 wake.config.json，请改到专用的项目代码目录",
      text
    );
  }

  return text;
}
