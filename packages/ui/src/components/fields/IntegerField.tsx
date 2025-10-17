"use client";

import { cn } from "../../lib/utils.js";

export interface IntegerFieldProps {
  name: string;
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: "read" | "edit";
  min?: number;
  max?: number;
}

export function IntegerField({
  name,
  value,
  onChange,
  label,
  placeholder,
  error,
  disabled,
  required,
  mode = "edit",
  min,
  max,
}: IntegerFieldProps) {
  if (mode === "read") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <p className="text-sm">{value !== null ? value : "-"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        value={value ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val === "" ? null : parseInt(val, 10));
        }}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        min={min}
        max={max}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive",
        )}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
