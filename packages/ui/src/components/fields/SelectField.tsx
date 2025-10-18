"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../primitives/select.js";
import { Label } from "../../primitives/label.js";

export interface SelectFieldProps {
  name: string;
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  options: Array<{ label: string; value: string }>;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: "read" | "edit";
}

export function SelectField({
  name,
  value,
  onChange,
  label,
  options,
  error,
  disabled,
  required,
  mode = "edit",
}: SelectFieldProps) {
  if (mode === "read") {
    const selectedOption = options.find((opt) => opt.value === value);
    return (
      <div className="space-y-1">
        <Label className="text-muted-foreground">{label}</Label>
        <p className="text-sm">{selectedOption?.label || "-"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <Select
        value={value || undefined}
        onValueChange={(val) => onChange(val || null)}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger id={name} className={error ? "border-destructive" : ""}>
          <SelectValue placeholder="Select an option..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
