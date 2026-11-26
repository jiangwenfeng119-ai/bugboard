# 代码图谱

问答镜像的默认分支用 Graphify CLI（PyPI 包 `graphifyy`，命令 `graphify`，Apache-2.0）在代码机上抽出代码图。功能地图继续回答菜单和入口。代码图谱回答调用关系和文件位置。

## 产物放哪

图不进应用仓库，也不进 git 工作区。问答镜像在 `askRoot/<缩写>`，图在 `askRoot/graphs/<缩写>/graphify-out/`。`git clean -fd` 清不到这里。

- `graph.json`：代码机上 `graphify query` 用
- `GRAPH_REPORT.md`：写回 Bugboard，汇总页在功能地图下面展示全文
- `graph.html`：解压后不超过 8MB 时一并写回。超过 1MB 的先 gzip 再上传。汇总页新开页打开，响应带 `sandbox allow-scripts`，脚本不能读 Bugboard 的登录态
- `manifest.json`、`built-sha`：留在代码机，供增量更新和新鲜度比较

代码机钉住 `graphifyy` 0.9.120。只跑代码抽取，不调模型。

## 怎么建、怎么更新

构建是两条命令，输出目录是 `askRoot/graphs/<缩写>`：

```bash
graphify extract <镜像> --code-only --out <输出目录>
graphify cluster-only <输出目录> --no-label
```

`extract` 不带 `--force`，未改文件走 AST 缓存。`cluster-only --no-label` 写出报告和交互页，社区名保持枢纽编号，不调用模型。

触发：

1. 问答镜像的 `HEAD` 和 `built-sha` 不一致时增量重建。叫醒服务启动时核对一次，之后每 24 小时再核对。提交没变就跳过。
2. 汇总页「更新代码图谱」向叫醒服务发 `project.graph`，立刻对这个项目重跑。
3. 节点数掉到原来的七成以下，或命令失败，恢复备份，不覆盖 `built-sha`。自动任务不加 `--force`。

写回 `POST /api/projects/:id/code-graph`，用管理员级 Key。表 `ask_graphs` 存报告、提交号、节点数、边数和 html 路径。

## 问答怎么用

提示词带报告摘录（Summary、God Nodes、Surprising Connections，约 1500 字）和提交号前 8 位。菜单和入口仍先看功能地图和文档。

问题里出现「哪个文件 / 哪个函数 / 谁调用 / 调用关系 / 实现在哪 / 代码在哪 / 定义在哪」，并且 `graphify query` 返回了文件时，代码机直接回答这些文件，不启动对照镜像的 Agent。其他问题如果要进深度对照，把查询结果附在提示词里，只读点到的文件。

`INFERRED` 和 `AMBIGUOUS` 只当线索。动态调用、反射和仓库外的调用方不在图里。
