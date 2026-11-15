import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { assertDeployExecutable } from "../src/lib/deploy-command";
import { planGitSync } from "../src/lib/workspace-git";
import {
  assertDeployExecutable as runnerDeploy,
  deploySpawnPlan,
  gitSteps,
  parseRunnerArgs,
  planGitSync as runnerPlan,
  readReleaseConfig,
  runReleasePass,
  shanghaiHHMM,
} from "../scripts/release-runner.mjs";

const inputs = [
  { dirty: true, ahead: 0, behind: 2 },
  { dirty: false, ahead: 0, behind: 2 },
  { dirty: false, ahead: 3, behind: 0 },
  { dirty: false, ahead: 2, behind: 1 },
  { dirty: false, ahead: 1, behind: 1 },
  { dirty: false, ahead: 0, behind: 0 },
];

describe("release runner planning", () => {
  it("uses the same git decision as the library", () => {
    for (const input of inputs) {
      expect(runnerPlan(input)).toEqual(planGitSync(input));
    }
  });

  it("maps a plan to fetch-free git arguments", () => {
    expect(gitSteps("ff_pull", "main")).toEqual([["pull", "--ff-only", "origin", "main"]]);
    expect(gitSteps("push", "main")).toEqual([["push", "origin", "HEAD"]]);
    expect(gitSteps("up_to_date", "main")).toEqual([]);
    expect(() => gitSteps("rebase_pull", "main")).toThrow(/Git/);
    expect(() => gitSteps("ff_pull", "main;rm")).toThrow(/分支/);
  });

  it("reads wake config and clock arguments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-config-"));
    fs.writeFileSync(
      path.join(dir, "wake.config.json"),
      JSON.stringify({
        bugboardUrl: "http://127.0.0.1:3080",
        releaseKey: "bb_from_file",
        projects: { SOC: "/work/counter" },
      })
    );
    expect(readReleaseConfig({ BUGBOARD_RELEASE_KEY: "bb_from_env" }, dir)).toMatchObject({
      bugboardUrl: "http://127.0.0.1:3080",
      releaseKey: "bb_from_env",
      projects: { SOC: "/work/counter" },
    });
    expect(parseRunnerArgs(["--schedule", "--project=SOC", "--at=22:00"])).toEqual({
      schedule: true,
      project: "SOC",
      at: "22:00",
    });
    expect(shanghaiHHMM(new Date("2026-11-16T14:00:00.000Z"))).toBe("22:00");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("runReleasePass", () => {
  const job = {
    dispatchId: 7,
    projectId: 3,
    code: "SOC",
    slug: "counter",
    githubUrl: "https://github.com/acme/counter",
    defaultBranch: "main",
    deployMode: "restart",
    deployCommand: "/usr/local/bin/counter-deploy",
    trigger: "manual",
    bugIds: [4],
    detail: null,
  };

  function harness(overrides: {
    job?: Record<string, unknown> | null;
    porcelain?: string;
    counts?: string;
    ancestor?: number;
    headBranch?: string;
    execCode?: number;
    projects?: Record<string, string>;
    schedule?: boolean;
    at?: string;
  }) {
    const calls: { op: string; body: Record<string, unknown> }[] = [];
    const gitCalls: string[][] = [];
    const execCalls: string[] = [];
    let claimed = false;
    const request = async (body: Record<string, unknown>) => {
      calls.push({ op: String(body.op), body });
      if (body.op === "schedule") return { queued: [] };
      if (body.op === "claim") {
        if (claimed || overrides.job === null) return { job: null };
        claimed = true;
        return { job: { ...job, ...overrides.job } };
      }
      return { ok: true };
    };
    const git = (_cwd: string, args: string[]) => {
      gitCalls.push(args);
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        return { code: 0, stdout: "true\n", stderr: "" };
      }
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return { code: 0, stdout: `${overrides.headBranch ?? "main"}\n`, stderr: "" };
      }
      if (args[0] === "remote") return { code: 0, stdout: "git@github.com:acme/counter.git\n", stderr: "" };
      if (args[0] === "status") return { code: 0, stdout: overrides.porcelain ?? "", stderr: "" };
      if (args[0] === "rev-list") return { code: 0, stdout: overrides.counts ?? "0\t0\n", stderr: "" };
      if (args[0] === "merge-base") return { code: overrides.ancestor ?? 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: "abc1234def\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const exec = (command: string) => {
      execCalls.push(command);
      return { code: overrides.execCode ?? 0, stdout: "", stderr: overrides.execCode ? "boom" : "" };
    };
    const stat = () => ({ exists: true, isDirectory: true });
    return { calls, gitCalls, execCalls, request, git, exec, stat, overrides };
  }

  it("syncs a clean tree, runs the deploy command, and marks the head", async () => {
    const { calls, gitCalls, execCalls, request, git, exec, stat } = harness({});
    const result = await runReleasePass({
      config: {
        bugboardUrl: "http://127.0.0.1:3080",
        releaseKey: "bb_test",
        projects: { SOC: "/work/counter" },
      },
      args: parseRunnerArgs(["--schedule"]),
      now: new Date("2026-11-16T14:00:00.000Z"),
      request,
      git,
      exec,
      stat,
    });
    expect(result).toMatchObject({ ran: 1, failed: 0 });
    expect(calls.map((call) => call.op)).toEqual(["schedule", "claim", "finish", "claim"]);
    expect(calls[0].body).toMatchObject({ op: "schedule", at: "22:00" });
    expect(calls[2].body).toMatchObject({
      op: "finish",
      dispatchId: 7,
      result: "success",
      headSha: "abc1234def",
    });
    expect(gitCalls.some((args) => args[0] === "fetch")).toBe(true);
    expect(gitCalls.some((args) => args[0] === "merge-base")).toBe(false);
    expect(execCalls).toEqual(["/usr/local/bin/counter-deploy"]);
  });

  it("marks a dirty tree failed and does not deploy", async () => {
    const { calls, execCalls, request, git, exec, stat } = harness({ porcelain: " M app.ts\n" });
    const result = await runReleasePass({
      config: {
        bugboardUrl: "http://127.0.0.1:3080",
        releaseKey: "bb_test",
        projects: { SOC: "/work/counter" },
      },
      args: parseRunnerArgs([]),
      request,
      git,
      exec,
      stat,
    });
    expect(result.failed).toBe(1);
    expect(execCalls).toEqual([]);
    expect(calls.find((call) => call.op === "finish")?.body).toMatchObject({
      result: "failed",
      detail: "工作区有未提交改动",
    });
  });

  it("refuses automatic deploy when the project mode is none", async () => {
    const { calls, gitCalls, request, git, exec, stat } = harness({ job: { deployMode: "none", deployCommand: "" } });
    await runReleasePass({
      config: {
        bugboardUrl: "http://127.0.0.1:3080",
        releaseKey: "bb_test",
        projects: { SOC: "/work/counter" },
      },
      args: parseRunnerArgs(["--project=SOC"]),
      request,
      git,
      exec,
      stat,
    });
    expect(gitCalls).toEqual([]);
    expect(calls[0].body).toMatchObject({ op: "claim", project: "SOC" });
    expect(calls.find((call) => call.op === "finish")?.body.detail).toBe("该项目不自动部署");
  });

  it("stops when origin does not match the project repository", async () => {
    const { calls, execCalls, request, git, exec, stat } = harness({
      job: { githubUrl: "https://github.com/acme/other" },
    });
    await runReleasePass({
      config: {
        bugboardUrl: "http://127.0.0.1:3080",
        releaseKey: "bb_test",
        projects: { counter: "/work/counter" },
      },
      args: parseRunnerArgs([]),
      request,
      git,
      exec,
      stat,
    });
    expect(execCalls).toEqual([]);
    expect(String(calls.find((call) => call.op === "finish")?.body.detail)).toContain("origin");
  });

  it("aborts a diverge and a branch that is not the project default", async () => {
    const diverged = harness({ counts: "2\t3\n" });
    await runReleasePass({
      config: {
        bugboardUrl: "http://127.0.0.1:3080",
        releaseKey: "bb_test",
        projects: { SOC: "/work/counter" },
      },
      args: parseRunnerArgs([]),
      request: diverged.request,
      git: diverged.git,
      exec: diverged.exec,
      stat: diverged.stat,
    });
    expect(diverged.execCalls).toEqual([]);
    expect(diverged.gitCalls.some((args) => args[0] === "pull" || args[0] === "push")).toBe(false);
    expect(diverged.calls.find((call) => call.op === "finish")?.body.detail).toBe(
      "本地与远端已经分叉，需要人工处理"
    );

    const wrongBranch = harness({ headBranch: "feature" });
    await runReleasePass({
      config: {
        bugboardUrl: "http://127.0.0.1:3080",
        releaseKey: "bb_test",
        projects: { SOC: "/work/counter" },
      },
      args: parseRunnerArgs([]),
      request: wrongBranch.request,
      git: wrongBranch.git,
      exec: wrongBranch.exec,
      stat: wrongBranch.stat,
    });
    expect(wrongBranch.execCalls).toEqual([]);
    expect(wrongBranch.gitCalls.some((args) => args[0] === "fetch")).toBe(false);
    expect(wrongBranch.calls.find((call) => call.op === "finish")?.body.detail).toBe(
      "当前分支不是项目默认分支"
    );
  });

  it("rejects shell pipelines instead of spawning them", async () => {
    for (const deployCommand of ["bash -c 'echo hi'", "foo && bar"]) {
      const run = harness({ job: { deployCommand } });
      await runReleasePass({
        config: {
          bugboardUrl: "http://127.0.0.1:3080",
          releaseKey: "bb_test",
          projects: { SOC: "/work/counter" },
        },
        args: parseRunnerArgs([]),
        request: run.request,
        git: run.git,
        exec: run.exec,
        stat: run.stat,
      });
      expect(run.execCalls).toEqual([]);
      expect(run.gitCalls).toEqual([]);
      expect(String(run.calls.find((call) => call.op === "finish")?.body.detail)).toMatch(/发布命令/);
    }
  });
});

describe("deploy command", () => {
  const samples: { command: string; workspace?: string }[] = [
    { command: "/usr/local/bin/counter-deploy" },
    { command: "/Users/me/bin/deploy.sh" },
    { command: "/opt/acme/ecs-deploy" },
    { command: "/work/counter/deploy.sh", workspace: "/work/counter" },
    { command: "bash -c 'echo hi'" },
    { command: "foo && bar" },
    { command: "/usr/bin/bash" },
    { command: "/tmp/deploy.sh" },
    { command: "/work/counter/deploy.sh" },
  ];

  it("matches the library rule and never uses a shell", () => {
    for (const sample of samples) {
      let library: string | Error;
      let runner: string | Error;
      try {
        library = assertDeployExecutable(sample.command, sample.workspace);
      } catch (error) {
        library = error instanceof Error ? error : new Error(String(error));
      }
      try {
        runner = runnerDeploy(sample.command, sample.workspace);
      } catch (error) {
        runner = error instanceof Error ? error : new Error(String(error));
      }
      if (library instanceof Error || runner instanceof Error) {
        expect(runner).toBeInstanceOf(Error);
        expect(library).toBeInstanceOf(Error);
        expect((runner as Error).message).toBe((library as Error).message);
      } else {
        expect(runner).toBe(library);
      }
    }
    expect(deploySpawnPlan("/usr/local/bin/counter-deploy", "/work/counter")).toEqual({
      cmd: "/usr/local/bin/counter-deploy",
      args: [],
      shell: false,
    });
    expect(deploySpawnPlan("/work/counter/deploy.sh", "/work/counter").shell).toBe(false);
    expect(() => deploySpawnPlan("bash -c 'echo hi'", "/work/counter")).toThrow(/shell/);
    expect(() => deploySpawnPlan("foo && bar", "/work/counter")).toThrow(/shell/);
  });
});
