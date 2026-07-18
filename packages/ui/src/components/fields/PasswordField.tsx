'use client'

import { Input } from '../../primitives/input.js'
import { Button } from '../../primitives/button.js'
import { cn } from '../../lib/utils.js'
import { useState } from 'react'
import { FieldRoot, FieldLabel, FieldHelp, FieldError, FieldReadValue } from './field-shell.js'

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
  helpText?: string
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
  helpText,
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
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{isPasswordSet ? '••••••••' : 'Not set'}</FieldReadValue>
      </FieldRoot>
    )
  }

  // If not changing password and it's set, show the button
  if (!isChangingPassword && isSetObject) {
    return (
      <FieldRoot>
        <FieldLabel>{label}</FieldLabel>
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
        {helpText && <FieldHelp>{helpText}</FieldHelp>}
      </FieldRoot>
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
      <FieldRoot>
        <FieldLabel htmlFor={name} required={required && !isPasswordSet}>
          {label}
        </FieldLabel>
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
        {helpText && <FieldHelp>{helpText}</FieldHelp>}
        {error && <FieldError>{error}</FieldError>}
      </FieldRoot>

      {showConfirm && (
        <FieldRoot>
          <FieldLabel htmlFor={`${name}-confirm`} required={required && !isPasswordSet}>
            Confirm {label}
          </FieldLabel>
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
          {confirmError && <FieldError>{confirmError}</FieldError>}
        </FieldRoot>
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
