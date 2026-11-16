"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthStory } from "@/components/AuthStory";
import { BrandMark } from "@/components/BrandMark";
import { PasswordField } from "@/components/PasswordField";

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "首装失败");
      return;
    }
    router.push("/projects");
    router.refresh();
  }

  return (
    <div className="bb-auth">
      <div className="bb-auth-shell">
        <aside className="bb-auth-visual">
          <div>
            <div className="bb-auth-brand-row">
              <BrandMark size={32} />
              Bugboard
            </div>
            <h2>第一次启动，先建好超级管理员</h2>
            <p>空库首装只需一步。这个账号可以任命管理员，也可以删除项目。</p>
          </div>
          <AuthStory />
        </aside>
        <form className="bb-auth-card" onSubmit={onSubmit}>
          <h1>开始使用</h1>
          <p className="bb-muted" style={{ marginTop: 0, marginBottom: "1.4rem" }}>
            创建第一个超级管理员账号
          </p>
          <div className="bb-field">
            <label className="bb-label" htmlFor="username">
              用户名
            </label>
            <input
              id="username"
              className="bb-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <PasswordField
            id="password"
            label="密码（至少 6 位）"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={6}
            required
          />
          {error ? <p className="bb-error">{error}</p> : null}
          <button className="bb-btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "创建中…" : "创建超级管理员并进入"}
          </button>
        </form>
      </div>
    </div>
  );
}
