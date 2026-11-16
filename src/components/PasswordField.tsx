"use client";

import { useState } from "react";
import { IconEye, IconEyeOff } from "@/components/Icons";

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="bb-field">
      <label className="bb-label" htmlFor={id}>
        {label}
      </label>
      <div className="bb-password">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className="bb-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          className="bb-password-toggle"
          aria-pressed={visible}
          aria-label={visible ? "隐藏密码" : "显示密码"}
          onClick={() => setVisible((open) => !open)}
        >
          {visible ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
    </div>
  );
}
