"use client";

import { Input } from "../../primitives/input.js";
import { Label } from "../../primitives/label.js";
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
        <Label className="text-muted-foreground">{label}</Label>
        <p className="text-sm">{value !== null ? value : "-"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Input
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
        className={cn(error && "border-destructive")}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
