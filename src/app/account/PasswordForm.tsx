"use client";

import { FormEvent, useState } from "react";
import { PasswordField } from "@/components/PasswordField";

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
      <PasswordField
        id="current-password"
        label="当前密码"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        required
      />
      <PasswordField
        id="new-password"
        label="新密码"
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
        minLength={6}
        required
        hint="至少 6 位"
      />
      <PasswordField
        id="confirm-password"
        label="确认新密码"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
        minLength={6}
        required
      />
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
