"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthStory } from "@/components/AuthStory";
import { BrandMark } from "@/components/BrandMark";
import { PasswordField } from "@/components/PasswordField";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/setup")
      .then((r) => r.json())
      .then((d) => {
        if (d.setupRequired) router.replace("/setup");
      })
      .catch(() => undefined);
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "登录失败");
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
            <h2>Agent 先处理，人在关键处把关</h2>
            <p>提报之后由 Agent 接单、修复并排队发布。做不做交给产品经理，上线结果由原报障人确认。</p>
          </div>
          <AuthStory />
        </aside>
        <form className="bb-auth-card" onSubmit={onSubmit}>
          <h1>欢迎回来</h1>
          <p className="bb-muted" style={{ marginTop: 0, marginBottom: "1.4rem" }}>
            登录以进入报障系统
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
            label="密码"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
          {error ? <p className="bb-error">{error}</p> : null}
          <button className="bb-btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
