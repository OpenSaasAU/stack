"use client";

import { cn } from "../../lib/utils.js";
import { useState } from "react";

export interface PasswordFieldProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: "read" | "edit";
  showConfirm?: boolean;
}

export function PasswordField({
  name,
  value,
  onChange,
  label,
  placeholder,
  error,
  disabled,
  required,
  mode = "edit",
  showConfirm = true,
}: PasswordFieldProps) {
  const [confirmValue, setConfirmValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  if (mode === "read") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <p className="text-sm">••••••••</p>
      </div>
    );
  }

  const confirmError =
    showConfirm && value !== confirmValue && confirmValue !== ""
      ? "Passwords do not match"
      : undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor={name} className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </label>
        <div className="relative">
          <input
            id={name}
            name={name}
            type={showPassword ? "text" : "password"}
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            required={required}
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm pr-10",
              "ring-offset-background",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-destructive",
            )}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? "👁️" : "👁️‍🗨️"}
          </button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {showConfirm && (
        <div className="space-y-2">
          <label htmlFor={`${name}-confirm`} className="text-sm font-medium">
            Confirm {label}
            {required && <span className="text-destructive ml-1">*</span>}
          </label>
          <input
            id={`${name}-confirm`}
            name={`${name}-confirm`}
            type={showPassword ? "text" : "password"}
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            placeholder={`Confirm ${placeholder || label.toLowerCase()}`}
            disabled={disabled}
            required={required}
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              "ring-offset-background",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              confirmError && "border-destructive",
            )}
          />
          {confirmError && (
            <p className="text-sm text-destructive">{confirmError}</p>
          )}
        </div>
      )}
    </div>
  );
}
