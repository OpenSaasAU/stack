"use client";

import { Input } from "../../primitives/input.js";
import { Label } from "../../primitives/label.js";
import { cn } from "../../lib/utils.js";

export interface TextFieldProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: "read" | "edit";
}

export function TextField({
  name,
  value,
  onChange,
  label,
  placeholder,
  error,
  disabled,
  required,
  mode = "edit",
}: TextFieldProps) {
  if (mode === "read") {
    return (
      <div className="space-y-1">
        <Label className="text-muted-foreground">{label}</Label>
        <p className="text-sm">{value || "-"}</p>
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
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={cn(error && "border-destructive")}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
