'use client'

import { Input } from '../../primitives/input.js'
import { Label } from '../../primitives/label.js'
import { Button } from '../../primitives/button.js'
import { cn } from '../../lib/utils.js'
import { useState } from 'react'

export interface PasswordFieldProps {
  name: string
  value: string | { isSet: boolean }
  onChange: (value: string | { isSet: boolean } | undefined) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  required?: boolean
  mode?: 'read' | 'edit'
  showConfirm?: boolean
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
  mode = 'edit',
  showConfirm = true,
}: PasswordFieldProps) {
  // Check if value is the isSet object
  const isSetObject = typeof value === 'object' && value !== null && 'isSet' in value
  const isPasswordSet = isSetObject ? value.isSet : false

  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordValue, setPasswordValue] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  if (mode === 'read') {
    return (
      <div className="space-y-1">
        <Label className="text-muted-foreground">{label}</Label>
        <p className="text-sm">{isPasswordSet ? '••••••••' : 'Not set'}</p>
      </div>
    )
  }

  // If not changing password and it's set, show the button
  if (!isChangingPassword && isSetObject) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsChangingPassword(true)}
            disabled={disabled}
          >
            {isPasswordSet ? 'Change Password' : 'Set Password'}
          </Button>
        </div>
      </div>
    )
  }

  const confirmError =
    showConfirm && passwordValue !== confirmValue && confirmValue !== ''
      ? 'Passwords do not match'
      : undefined

  const handleCancel = () => {
    setIsChangingPassword(false)
    setPasswordValue('')
    setConfirmValue('')
    setShowPassword(false)
    // Reset to the isSet object
    if (isSetObject) {
      onChange(value)
    }
  }

  const handlePasswordChange = (newValue: string) => {
    setPasswordValue(newValue)
    // Update the parent with the actual password string
    onChange(newValue || undefined)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={name}>
          {label}
          {required && !isPasswordSet && <span className="text-destructive ml-1">*</span>}
        </Label>
        <div className="relative">
          <Input
            id={name}
            name={name}
            type={showPassword ? 'text' : 'password'}
            value={passwordValue}
            onChange={(e) => handlePasswordChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            required={required && !isPasswordSet}
            className={cn('pr-10', error && 'border-destructive')}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? '👁️' : '👁️‍🗨️'}
          </button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {showConfirm && (
        <div className="space-y-2">
          <Label htmlFor={`${name}-confirm`}>
            Confirm {label}
            {required && !isPasswordSet && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Input
            id={`${name}-confirm`}
            name={`${name}-confirm`}
            type={showPassword ? 'text' : 'password'}
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            placeholder={`Confirm ${placeholder || label.toLowerCase()}`}
            disabled={disabled}
            required={required && !isPasswordSet}
            className={cn(confirmError && 'border-destructive')}
          />
          {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
        </div>
      )}

      {isSetObject && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={disabled}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
