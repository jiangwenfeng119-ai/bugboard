"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  behaviorDefaults,
  describeBehavior,
  WAKE_ACTIONS,
  WAKE_ACTION_LABELS,
  type BehaviorHighlight,
  type BehaviorSettings,
  type WakeAction,
} from "@/lib/behavior-shared";

type ProjectOption = { id: number; name: string };

export type BehaviorOverviewRow = {
  projectId: number;
  projectName: string;
  highlights: BehaviorHighlight[];
};

type EditorState =
  | { mode: "edit"; project: ProjectOption; initial: BehaviorSettings }
  | null;

export function BehaviorAdmin({
  projects,
  overviews,
  editor,
}: {
  projects: ProjectOption[];
  overviews: BehaviorOverviewRow[];
  editor: EditorState;
}) {
  const router = useRouter();
  const configured = new Set(overviews.map((item) => item.projectId));
  const available = projects.filter((project) => !configured.has(project.id));

  if (editor?.mode === "edit") {
    return (
      <BehaviorEditor
        key={editor.project.id}
        mode="edit"
        project={editor.project}
        initial={editor.initial}
      />
    );
  }

  return (
    <BehaviorList
      overviews={overviews}
      available={available}
      canCreate={available.length > 0}
      createReason={
        projects.length === 0
          ? "还没有项目。先建一个项目，再来新增行为。"
          : "每个项目已经有一套配置。要修改，用这一行的编辑。"
      }
      onSaved={() => router.refresh()}
    />
  );
}

function BehaviorList({
  overviews,
  available,
  canCreate,
  createReason,
  onSaved,
}: {
  overviews: BehaviorOverviewRow[];
  available: ProjectOption[];
  canCreate: boolean;
  createReason: string;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <section className="bb-card bb-section-card bb-dispatch">
      <div className="bb-dispatch-head">
        <div>
          <h2>行为</h2>
          <p className="bb-muted bb-dispatch-lead">
            每个项目一套协作开关。叫到哪台机器、开不开整理和 Cursor、发布命令和定时，去{" "}
            <a href="/admin?tab=wake">分派给 Agent</a>。
          </p>
          <p className="bb-muted bb-dispatch-lead">
            清单里是已经保存过的项目，每条用短标签列出关键开关。新项目点右上角「新增」，从待选项目里选一个再配置保存。细节在「编辑」里改。
          </p>
          {!canCreate ? <p className="bb-dispatch-reason">{createReason}</p> : null}
        </div>
        <button
          type="button"
          className="bb-btn"
          onClick={() => setCreating(true)}
          disabled={!canCreate}
          title={canCreate ? undefined : createReason}
        >
          新增
        </button>
      </div>
      {overviews.length === 0 ? (
        <p className="bb-muted bb-dispatch-empty">
          还没有行为配置。点「新增」，从项目里选一个再保存，就会出现在这份清单里。
        </p>
      ) : (
        <ul className="bb-behavior-list">
          {overviews.map((item) => (
            <li key={item.projectId} className="bb-behavior-row">
              <div className="bb-behavior-row-head">
                <h3 className="bb-behavior-row-title">{item.projectName}</h3>
                <button
                  type="button"
                  className="bb-btn bb-btn-secondary"
                  onClick={() => router.push(`/admin?tab=behavior&project=${item.projectId}`)}
                >
                  编辑
                </button>
              </div>
              <dl className="bb-behavior-facts">
                {item.highlights.map((fact) => (
                  <div key={fact.label} className="bb-behavior-fact">
                    <dt>{fact.label}</dt>
                    <dd className={fact.on ? "is-on" : undefined}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <BehaviorCreateModal
          projects={available}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onSaved();
          }}
        />
      ) : null}
    </section>
  );
}

function BehaviorCreateModal({
  projects,
  onClose,
  onSaved,
}: {
  projects: ProjectOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [projectId, setProjectId] = useState(projects.length === 1 ? projects[0].id : 0);
  const [settings, setSettings] = useState<BehaviorSettings>(() => behaviorDefaults());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    document.body.classList.add("bb-modal-open");
    return () => {
      document.body.classList.remove("bb-modal-open");
    };
  }, []);

  async function save() {
    if (!projectId) {
      setError("先选择一个项目");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/behavior`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = (await res.json()) as { error?: string; settings?: BehaviorSettings };
      if (!res.ok || !data.settings) throw new Error(data.error || "保存失败");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="bb-modal" role="presentation">
      <button type="button" className="bb-modal-backdrop" aria-label="关闭新增行为" onClick={onClose} />
      <div
        className="bb-modal-card bb-behavior-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="bb-sheet-head">
          <div>
            <h2 id={titleId}>新增行为</h2>
            <p className="bb-muted">从还没有行为配置的项目里选一个，改完保存后会出现在清单里。</p>
          </div>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onClose} disabled={loading}>
            关闭
          </button>
        </div>
        <div className="bb-sheet-body">
          {projects.length === 0 ? (
            <p className="bb-muted">每个项目已经有一套配置。要修改，请从清单进入编辑。</p>
          ) : (
            <>
              <div className="bb-field">
                <label className="bb-label" htmlFor="bb-behavior-create-project">
                  项目
                </label>
                <select
                  id="bb-behavior-create-project"
                  className="bb-select"
                  value={projectId || ""}
                  onChange={(event) => {
                    setProjectId(Number(event.target.value) || 0);
                    setSettings(behaviorDefaults());
                    setError("");
                  }}
                >
                  <option value="">选择项目</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <BehaviorFields settings={settings} onChange={setSettings} />
              {error ? <p className="bb-error">{error}</p> : null}
              <div className="bb-dispatch-actions">
                <button type="button" className="bb-btn bb-btn-ghost" onClick={onClose} disabled={loading}>
                  取消
                </button>
                <button type="button" className="bb-btn" onClick={save} disabled={loading || !projectId}>
                  {loading ? "保存中…" : "保存行为"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function BehaviorEditor({
  mode,
  project,
  initial,
}: {
  mode: "edit";
  project: ProjectOption;
  initial: BehaviorSettings;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch(`/api/projects/${project.id}/behavior`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = (await res.json()) as { error?: string; settings?: BehaviorSettings };
      if (!res.ok || !data.settings) throw new Error(data.error || "保存失败");
      setSettings(data.settings);
      setSaved("已保存。");
      router.push("/admin?tab=behavior");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bb-card bb-section-card bb-dispatch">
      <div className="bb-dispatch-head">
        <div>
          <h2>{mode === "edit" ? "编辑行为" : "新增行为"}</h2>
          <p className="bb-muted bb-dispatch-lead">
            正在改「{project.name}」。叫到哪台机器去{" "}
            <a href={`/admin?tab=wake&project=${project.id}`}>分派给 Agent</a>。
          </p>
        </div>
        <button
          type="button"
          className="bb-btn bb-btn-ghost"
          onClick={() => router.push("/admin?tab=behavior")}
        >
          返回清单
        </button>
      </div>
      <div className="bb-dispatch-guide">
        {describeBehavior(settings).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <BehaviorFields settings={settings} onChange={setSettings} />
      {error ? <p className="bb-error">{error}</p> : null}
      {saved ? <p className="bb-field-hint">{saved}</p> : null}
      <div className="bb-dispatch-actions">
        <button
          type="button"
          className="bb-btn bb-btn-ghost"
          onClick={() => router.push("/admin?tab=behavior")}
          disabled={loading}
        >
          取消
        </button>
        <button type="button" className="bb-btn" onClick={save} disabled={loading}>
          {loading ? "保存中…" : "保存行为"}
        </button>
      </div>
    </section>
  );
}

function BehaviorFields({
  settings,
  onChange,
}: {
  settings: BehaviorSettings;
  onChange: (next: BehaviorSettings) => void;
}) {
  function patch(next: Partial<BehaviorSettings>) {
    onChange({ ...settings, ...next });
  }

  function toggleAction(action: WakeAction) {
    const has = settings.wakeActions.includes(action);
    patch({
      wakeActions: has
        ? settings.wakeActions.filter((item) => item !== action)
        : WAKE_ACTIONS.filter((item) => item === action || settings.wakeActions.includes(item)),
    });
  }

  return (
    <>
      <fieldset className="bb-dispatch-channel">
        <legend>叫醒</legend>
        <div className="bb-wake-options">
          <div className="bb-wake-group">
            <p className="bb-wake-group-title">建单后</p>
            <div className="bb-wake-checks">
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
            </div>
          </div>
          <div className="bb-wake-group">
            <p className="bb-wake-group-title">状态变化后再叫</p>
            <div className="bb-wake-checks">
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
            </div>
            <p className="bb-field-hint">
              人点「可以做」才会叫醒。Agent 或 API Key 自己点不另开。开始修复、提交修复、确认、标不属实、要求补充、请产品确认、拒绝产品和发布都不会叫醒。
            </p>
          </div>
          <div className="bb-wake-group">
            <p className="bb-wake-group-title">处理范围</p>
            <div className="bb-wake-checks">
              <label className="bb-checkline">
                <input
                  type="checkbox"
                  checked={settings.wakeDrainQueue}
                  onChange={(event) => patch({ wakeDrainQueue: event.target.checked })}
                />
                处理完继续其余待处理
              </label>
            </div>
            <p className="bb-field-hint">项目没开本机修理、也没开 Cursor 时，这些开关开着也不会发出请求。</p>
          </div>
        </div>
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
      <fieldset className="bb-dispatch-channel">
        <legend>项目问答</legend>
        <label className="bb-checkline">
          <input
            type="checkbox"
            checked={settings.askEnabled}
            onChange={(event) => patch({ askEnabled: event.target.checked })}
          />
          打开只读问答
        </label>
        <BoundedNumber
          id="bb-ask-hour"
          label="每人每小时最多提问"
          hint="1 到 60。超过后要等下一个小时。问答不能改代码。"
          value={settings.askPerHour}
          min={1}
          max={60}
          onCommit={(askPerHour) => patch({ askPerHour })}
        />
      </fieldset>
    </>
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
