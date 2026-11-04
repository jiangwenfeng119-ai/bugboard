"use client";

import { FormEvent, useState } from "react";

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (newPassword.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "修改失败");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess("密码已更新，下次登录请使用新密码。");
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="bb-field">
        <label className="bb-label" htmlFor="current-password">
          当前密码
        </label>
        <input
          id="current-password"
          className="bb-input"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="bb-field">
        <label className="bb-label" htmlFor="new-password">
          新密码
        </label>
        <input
          id="new-password"
          className="bb-input"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <p className="bb-muted" style={{ margin: "0.35rem 0 0", fontSize: "0.82rem" }}>
          至少 6 位
        </p>
      </div>
      <div className="bb-field">
        <label className="bb-label" htmlFor="confirm-password">
          确认新密码
        </label>
        <input
          id="confirm-password"
          className="bb-input"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
      </div>
      {error ? <p className="bb-error">{error}</p> : null}
      {success ? (
        <p className="bb-success" role="status">
          {success}
        </p>
      ) : null}
      <button className="bb-btn" type="submit" disabled={loading}>
        {loading ? "保存中…" : "更新密码"}
      </button>
    </form>
  );
}
