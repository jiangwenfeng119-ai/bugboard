"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  describeBehavior,
  WAKE_ACTIONS,
  WAKE_ACTION_LABELS,
  type BehaviorSettings,
  type WakeAction,
} from "@/lib/behavior-shared";

type ProjectOption = { id: number; name: string };

export function BehaviorAdmin({
  projects,
  projectId,
  initial,
}: {
  projects: ProjectOption[];
  projectId: number | null;
  initial: BehaviorSettings | null;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<BehaviorSettings | null>(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);

  function chooseProject(id: string) {
    router.push(id ? `/admin?tab=behavior&project=${id}` : "/admin?tab=behavior");
  }

  function patch(next: Partial<BehaviorSettings>) {
    setSettings((current) => (current ? { ...current, ...next } : current));
    setSaved("");
  }

  function toggleAction(action: WakeAction) {
    if (!settings) return;
    const has = settings.wakeActions.includes(action);
    patch({
      wakeActions: has
        ? settings.wakeActions.filter((item) => item !== action)
        : WAKE_ACTIONS.filter((item) => item === action || settings.wakeActions.includes(item)),
    });
  }

  async function save() {
    if (!projectId || !settings) return;
    setLoading(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch(`/api/projects/${projectId}/behavior`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = (await res.json()) as { error?: string; settings?: BehaviorSettings };
      if (!res.ok || !data.settings) throw new Error(data.error || "保存失败");
      setSettings(data.settings);
      setSaved("已保存。没改过的项目仍按原来的行为。");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bb-card bb-section-card">
      <h2>行为</h2>
      <p className="bb-field-hint">
        这里决定团队怎么协作。叫到哪台机器、开不开整理和 Cursor、发布命令和定时，去{" "}
        <a href={projectId ? `/admin?tab=wake&project=${projectId}` : "/admin?tab=wake"}>分派给 Agent</a>
        。
      </p>
      <div className="bb-field">
        <label className="bb-label" htmlFor="bb-behavior-project">
          项目
        </label>
        <select
          id="bb-behavior-project"
          className="bb-select"
          value={projectId ?? ""}
          onChange={(event) => chooseProject(event.target.value)}
        >
          <option value="">选择项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      {!settings ? <p className="bb-field-hint">先选择一个项目。</p> : null}
      {settings ? (
        <>
          <div className="bb-dispatch-guide">
            {describeBehavior(settings).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <fieldset className="bb-dispatch-channel">
            <legend>叫醒</legend>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.wakeOnWebCreate}
                onChange={(event) => patch({ wakeOnWebCreate: event.target.checked })}
              />
              网页建单后叫醒
            </label>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.wakeOnWidgetCreate}
                onChange={(event) => patch({ wakeOnWidgetCreate: event.target.checked })}
              />
              小组件上报后叫醒
            </label>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.wakeOnCaptureCreate}
                onChange={(event) => patch({ wakeOnCaptureCreate: event.target.checked })}
              />
              走查提交后叫醒
            </label>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.wakeOnApiCreate}
                onChange={(event) => patch({ wakeOnApiCreate: event.target.checked })}
              />
              MCP / API Key 建单后叫醒
            </label>
            {WAKE_ACTIONS.map((action) => (
              <label className="bb-checkline" key={action}>
                <input
                  type="checkbox"
                  checked={settings.wakeActions.includes(action)}
                  onChange={() => toggleAction(action)}
                />
                {WAKE_ACTION_LABELS[action]}
              </label>
            ))}
            <p className="bb-field-hint">
              人点「可以做」才会叫醒。Agent 或 API Key 自己点不另开。开始修复、提交修复、确认、标不属实、要求补充、请产品确认、拒绝产品和发布都不会叫醒。
            </p>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.wakeDrainQueue}
                onChange={(event) => patch({ wakeDrainQueue: event.target.checked })}
              />
              处理完继续其余待处理
            </label>
            <p className="bb-field-hint">项目没开本机修理、也没开 Cursor 时，这些开关开着也不会发出请求。</p>
          </fieldset>
          <fieldset className="bb-dispatch-channel">
            <legend>建单默认</legend>
            <div className="bb-field">
              <label className="bb-label" htmlFor="bb-intake-priority">
                小组件和走查的默认优先级
              </label>
              <select
                id="bb-intake-priority"
                className="bb-select"
                value={settings.intakePriority}
                onChange={(event) =>
                  patch({ intakePriority: event.target.value as BehaviorSettings["intakePriority"] })
                }
              >
                <option value="p1">P1</option>
                <option value="p2">P2</option>
                <option value="p3">P3</option>
              </select>
              <p className="bb-field-hint">网页建单仍由报障人自己选。</p>
            </div>
          </fieldset>
          <fieldset className="bb-dispatch-channel">
            <legend>管理员收件箱</legend>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.inboxShowPending}
                onChange={(event) => patch({ inboxShowPending: event.target.checked })}
              />
              待处理
            </label>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.inboxShowNeedsProduct}
                onChange={(event) => patch({ inboxShowNeedsProduct: event.target.checked })}
              />
              待产品经理确认
            </label>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.inboxShowReady}
                onChange={(event) => patch({ inboxShowReady: event.target.checked })}
              />
              待发布
            </label>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.inboxShowOwnFixing}
                onChange={(event) => patch({ inboxShowOwnFixing: event.target.checked })}
              />
              自己接手的修复中
            </label>
            <BoundedNumber
              id="bb-inbox-cap"
              label="待处理最多列出"
              hint="1 到 30。超出的仍计入溢出。报障人自己的待确认、待补充、不属实始终出现。"
              value={settings.inboxPendingCap}
              min={1}
              max={30}
              onCommit={(inboxPendingCap) => patch({ inboxPendingCap })}
            />
          </fieldset>
          <fieldset className="bb-dispatch-channel">
            <legend>发布之后</legend>
            <label className="bb-checkline">
              <input
                type="checkbox"
                checked={settings.releaseAdvancesBugs}
                onChange={(event) => patch({ releaseAdvancesBugs: event.target.checked })}
              />
              发布成功后，待发布的单进入待确认
            </label>
            <BoundedNumber
              id="bb-release-timeout"
              label="发布任务超时（分钟）"
              hint="5 到 180。超时只释放这次任务，不改报障状态，也不自动重跑。"
              value={settings.releaseTimeoutMin}
              min={5}
              max={180}
              onCommit={(releaseTimeoutMin) => patch({ releaseTimeoutMin })}
            />
          </fieldset>
          <fieldset className="bb-dispatch-channel">
            <legend>走查草稿</legend>
            <BoundedNumber
              id="bb-capture-gap"
              label="停顿超过多少毫秒新开一条"
              value={settings.captureGapMs}
              min={200}
              max={10000}
              onCommit={(captureGapMs) => patch({ captureGapMs })}
            />
            <BoundedNumber
              id="bb-capture-short"
              label="少于此字数标成待确认"
              value={settings.captureShortChars}
              min={1}
              max={40}
              onCommit={(captureShortChars) => patch({ captureShortChars })}
            />
            <BoundedNumber
              id="bb-organize-timeout"
              label="整理超过多少分钟改用规则草稿"
              hint="整理开不开仍在分派页。停顿 200 到 10000 毫秒，短句 1 到 40 字，整理超时 1 到 60 分钟。"
              value={settings.organizeTimeoutMin}
              min={1}
              max={60}
              onCommit={(organizeTimeoutMin) => patch({ organizeTimeoutMin })}
            />
          </fieldset>
          {error ? <p className="bb-error">{error}</p> : null}
          {saved ? <p className="bb-field-hint">{saved}</p> : null}
          <button type="button" className="bb-btn" onClick={save} disabled={loading}>
            {loading ? "保存中…" : "保存行为"}
          </button>
        </>
      ) : null}
    </section>
  );
}

function BoundedNumber({
  id,
  label,
  hint,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(raw: string) {
    if (!/^\d+$/.test(raw)) return false;
    const next = Number(raw);
    if (next < min || next > max) return false;
    if (next !== value) onCommit(next);
    return true;
  }

  return (
    <div className="bb-field">
      <label className="bb-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="bb-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          commit(raw);
        }}
        onBlur={(event) => {
          const raw = event.currentTarget.value;
          if (!commit(raw)) {
            const restored = String(value);
            setText(restored);
            event.currentTarget.value = restored;
            return;
          }
          setText(String(Number(raw)));
        }}
      />
      {hint ? <p className="bb-field-hint">{hint}</p> : null}
    </div>
  );
}
