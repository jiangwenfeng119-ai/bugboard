"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import type { SeeAlsoItem } from "@/lib/services";

export function SeeAlso({ bugId, items }: { bugId: number; items: SeeAlsoItem[] }) {
  const router = useRouter();
  const [publicId, setPublicId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = publicId.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/bugs/${bugId}/see-also`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `没有标上（HTTP ${res.status}）`);
        return;
      }
      setPublicId("");
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function clear(otherId: number) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/bugs/${bugId}/see-also?otherId=${otherId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || `没有取消（HTTP ${res.status}）`);
        return;
      }
      router.refresh();
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bb-see-also">
      {items.length > 0 ? (
        <ul className="bb-see-also-list">
          {items.map((item) => (
            <li key={item.id} className="bb-see-also-row">
              <Link href={`/bugs/${item.id}`}>
                <span className="bb-bug-id">{item.publicId}</span>
                <span>{item.title}</span>
              </Link>
              <StatusBadge status={item.status} />
              <button
                type="button"
                className="bb-btn bb-btn-ghost"
                disabled={loading}
                onClick={() => void clear(item.id)}
              >
                取消
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bb-muted">同项目里的另一张单。两边都能看见，不改状态。</p>
      )}
      <form className="bb-see-also-form" onSubmit={(event) => void add(event)}>
        <label className="bb-sr-only" htmlFor={`see-also-${bugId}`}>
          报障编号
        </label>
        <input
          id={`see-also-${bugId}`}
          className="bb-input"
          value={publicId}
          onChange={(event) => setPublicId(event.target.value)}
          placeholder="报障编号"
          autoComplete="off"
        />
        <button className="bb-btn bb-btn-secondary" type="submit" disabled={loading || !publicId.trim()}>
          标上
        </button>
      </form>
      {error ? <p className="bb-error">{error}</p> : null}
    </div>
  );
}
