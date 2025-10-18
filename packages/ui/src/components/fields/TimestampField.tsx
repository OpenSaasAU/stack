"use client";

import { Input } from "../../primitives/input.js";
import { Label } from "../../primitives/label.js";
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
        <Label className="text-muted-foreground">{label}</Label>
        <p className="text-sm">{dateValue ? format(dateValue, "PPpp") : "-"}</p>
      </div>
    );
  }

  // Format for datetime-local input (YYYY-MM-DDTHH:mm)
  const inputValue = dateValue ? format(dateValue, "yyyy-MM-dd'T'HH:mm") : "";

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
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
        className={cn(error && "border-destructive")}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
