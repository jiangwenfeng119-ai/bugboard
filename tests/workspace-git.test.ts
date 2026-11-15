import { describe, expect, it } from "vitest";
import {
  originsMatch,
  parseAheadBehind,
  parseDirty,
  planGitSync,
  workspaceHealth,
} from "../src/lib/workspace-git";

describe("planGitSync", () => {
  it("aborts when the worktree is dirty, even if the branch is behind", () => {
    expect(
      planGitSync({ dirty: true, ahead: 0, behind: 3, remoteContainsLocalHead: true })
    ).toEqual({ action: "abort", reason: "工作区有未提交改动" });
  });

  it("fast-forwards when the branch is only behind", () => {
    expect(
      planGitSync({ dirty: false, ahead: 0, behind: 2, remoteContainsLocalHead: true })
    ).toEqual({ action: "ff_pull" });
  });

  it("pushes when the branch is only ahead", () => {
    expect(
      planGitSync({ dirty: false, ahead: 1, behind: 0, remoteContainsLocalHead: false })
    ).toEqual({ action: "push" });
  });

  it("rebases when local commits are unpushed and the remote is also ahead", () => {
    expect(
      planGitSync({ dirty: false, ahead: 2, behind: 1, remoteContainsLocalHead: false })
    ).toEqual({ action: "rebase_pull" });
  });

  it("aborts a diverge whose local tip is already on the remote", () => {
    expect(
      planGitSync({ dirty: false, ahead: 1, behind: 1, remoteContainsLocalHead: true })
    ).toEqual({ action: "abort", reason: "本地提交已经 push 后又与远端分叉" });
  });

  it("does nothing when the branch already matches the remote", () => {
    expect(
      planGitSync({ dirty: false, ahead: 0, behind: 0, remoteContainsLocalHead: true })
    ).toEqual({ action: "up_to_date" });
  });

  it("aborts when the ahead or behind counts are not usable", () => {
    expect(
      planGitSync({ dirty: false, ahead: -1, behind: 0, remoteContainsLocalHead: false })
    ).toEqual({ action: "abort", reason: "无法判断 Git 状态" });
  });
});

describe("git status parsers", () => {
  it("reads left-right counts as behind and ahead", () => {
    expect(parseAheadBehind("2\t4\n")).toEqual({ behind: 2, ahead: 4 });
    expect(parseAheadBehind("nope")).toBeNull();
  });

  it("treats any porcelain line as dirty", () => {
    expect(parseDirty("")).toBe(false);
    expect(parseDirty(" M src/app.ts\n")).toBe(true);
  });

  it("treats ssh and https origins as the same repository", () => {
    expect(originsMatch("git@github.com:acme/demo.git", "https://github.com/acme/demo")).toBe(true);
    expect(originsMatch("https://github.com/acme/demo", "https://github.com/acme/other")).toBe(false);
    expect(originsMatch("", "https://github.com/acme/demo")).toBe(false);
  });
});

describe("workspaceHealth", () => {
  it("requires a git directory whose origin matches the project repository", () => {
    expect(
      workspaceHealth({
        exists: true,
        isDirectory: true,
        isGit: true,
        originUrl: "git@github.com:acme/demo.git",
        githubUrl: "https://github.com/acme/demo",
      })
    ).toEqual({ ok: true });
    expect(
      workspaceHealth({
        exists: false,
        isDirectory: false,
        isGit: false,
        originUrl: "",
        githubUrl: "https://github.com/acme/demo",
      })
    ).toEqual({ ok: false, reason: "工作区不存在" });
    expect(
      workspaceHealth({
        exists: true,
        isDirectory: true,
        isGit: false,
        originUrl: "",
        githubUrl: "https://github.com/acme/demo",
      })
    ).toEqual({ ok: false, reason: "工作区不是 git 仓库" });
    expect(
      workspaceHealth({
        exists: true,
        isDirectory: true,
        isGit: true,
        originUrl: "https://github.com/acme/other",
        githubUrl: "https://github.com/acme/demo",
      })
    ).toEqual({ ok: false, reason: "origin 与代码仓地址不一致" });
  });
});
