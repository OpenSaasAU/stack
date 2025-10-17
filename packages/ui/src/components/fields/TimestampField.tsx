"use client";

import { cn } from "../../lib/utils.js";
import { format } from "date-fns";

export interface TimestampFieldProps {
  name: string;
  value: Date | string | null;
  onChange: (value: Date | null) => void;
  label: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: "read" | "edit";
}

export function TimestampField({
  name,
  value,
  onChange,
  label,
  error,
  disabled,
  required,
  mode = "edit",
}: TimestampFieldProps) {
  const dateValue = value ? new Date(value) : null;

  if (mode === "read") {
    return (
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          {label}
        </label>
        <p className="text-sm">{dateValue ? format(dateValue, "PPpp") : "-"}</p>
      </div>
    );
  }

  // Format for datetime-local input (YYYY-MM-DDTHH:mm)
  const inputValue = dateValue ? format(dateValue, "yyyy-MM-dd'T'HH:mm") : "";

  return (
    <div className="space-y-2">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type="datetime-local"
        value={inputValue}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val ? new Date(val) : null);
        }}
        disabled={disabled}
        required={required}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive",
        )}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
