"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";

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
            <h2>把报障闭环收进一张清晰的工单台账</h2>
            <p>提报、修复、确认同屏可见；状态可审计，适合人和 Agent 一起协作。</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="bb-auth-visual-art"
            src="/brand/auth-hero.png"
            alt=""
            width={420}
            height={315}
          />
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
          <div className="bb-field">
            <label className="bb-label" htmlFor="password">
              密码
            </label>
            <input
              id="password"
              type="password"
              className="bb-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error ? <p className="bb-error">{error}</p> : null}
          <button className="bb-btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
