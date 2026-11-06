'use client'

import { Input } from '../../primitives/input.js'
import { Button } from '../../primitives/button.js'
import { cn } from '../../lib/utils.js'
import { useRef, useState } from 'react'
import { useFieldValidity } from '../../lib/fieldValidity.js'
import {
  FieldRoot,
  FieldLabel,
  FieldHelp,
  FieldError,
  FieldReadValue,
  describeField,
  fieldErrorId,
  fieldHelpId,
  fieldLabelId,
  fieldValueId,
} from './field-shell.js'

export interface PasswordFieldProps {
  name: string
  /** The control's DOM id. `FieldRenderer` supplies one unique to the form. Defaults to `name`. */
  id?: string
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
  id = name,
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
  const isSetObject = typeof value === 'object' && value !== null && 'isSet' in value
  // `value` stops being the sentinel at the first keystroke, and Cancel has to restore it.
  const [loadedSentinel] = useState(isSetObject ? value : null)
  const sentinel = isSetObject ? value : loadedSentinel
  const isPasswordSet = sentinel?.isSet ?? false

  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [passwordValue, setPasswordValue] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [cancelledChange, setCancelledChange] = useState(false)
  const confirmRef = useRef<HTMLInputElement>(null)

  const isEditing = mode === 'edit' && (isChangingPassword || sentinel === null)
  const isUnconfirmed = isEditing && showConfirm && passwordValue !== confirmValue
  const submitRefused = useFieldValidity(name, isUnconfirmed, confirmRef)

  if (mode === 'read') {
    return (
      <FieldRoot mode="read">
        <FieldLabel muted>{label}</FieldLabel>
        <FieldReadValue>{isPasswordSet ? '••••••••' : 'Not set'}</FieldReadValue>
      </FieldRoot>
    )
  }

  if (!isEditing) {
    return (
      <FieldRoot>
        <FieldLabel id={fieldLabelId(id)} htmlFor={id}>
          {label}
        </FieldLabel>
        <div>
          <Button
            id={id}
            type="button"
            variant="outline"
            autoFocus={cancelledChange}
            onClick={() => setIsChangingPassword(true)}
            disabled={disabled}
            aria-labelledby={`${fieldLabelId(id)} ${fieldValueId(id)}`}
            {...describeField(id, { error, helpText })}
          >
            <span id={fieldValueId(id)}>{isPasswordSet ? 'Change Password' : 'Set Password'}</span>
          </Button>
        </div>
        {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
        {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
      </FieldRoot>
    )
  }

  const confirmId = `${id}-confirm`
  let confirmError: string | undefined
  if (isUnconfirmed && confirmValue !== '') confirmError = 'Passwords do not match'
  else if (isUnconfirmed && submitRefused)
    confirmError = `Re-enter ${label.toLowerCase()} to confirm`

  const handleCancel = () => {
    setIsChangingPassword(false)
    setCancelledChange(true)
    setPasswordValue('')
    setConfirmValue('')
    setShowPassword(false)
    if (sentinel !== null) {
      onChange(sentinel)
    }
  }

  const commit = (password: string, confirm: string) => {
    const isConfirmed = password !== '' && (!showConfirm || password === confirm)
    onChange(isConfirmed ? password : (sentinel ?? undefined))
  }

  const handlePasswordChange = (newValue: string) => {
    setPasswordValue(newValue)
    commit(newValue, confirmValue)
  }

  const handleConfirmChange = (newValue: string) => {
    setConfirmValue(newValue)
    commit(passwordValue, newValue)
  }

  return (
    <div className="space-y-4">
      <FieldRoot>
        <FieldLabel htmlFor={id} required={required && !isPasswordSet}>
          {label}
        </FieldLabel>
        <div className="relative">
          <Input
            id={id}
            name={name}
            type={showPassword ? 'text' : 'password'}
            autoFocus={isChangingPassword}
            value={passwordValue}
            onChange={(e) => handlePasswordChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            required={required && !isPasswordSet}
            className={cn('pr-10', error && 'border-destructive')}
            {...describeField(id, { error, helpText })}
          />
          <button
            type="button"
            aria-label={showPassword ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden="true">{showPassword ? '👁️' : '👁️‍🗨️'}</span>
          </button>
        </div>
        {helpText && <FieldHelp id={fieldHelpId(id)}>{helpText}</FieldHelp>}
        {error && <FieldError id={fieldErrorId(id)}>{error}</FieldError>}
      </FieldRoot>

      {showConfirm && (
        <FieldRoot>
          <FieldLabel htmlFor={confirmId} required={required && !isPasswordSet}>
            Confirm {label}
          </FieldLabel>
          <Input
            ref={confirmRef}
            id={confirmId}
            name={`${name}-confirm`}
            type={showPassword ? 'text' : 'password'}
            value={confirmValue}
            onChange={(e) => handleConfirmChange(e.target.value)}
            placeholder={`Confirm ${placeholder || label.toLowerCase()}`}
            disabled={disabled}
            required={required && !isPasswordSet}
            className={cn(confirmError && 'border-destructive')}
            {...describeField(confirmId, { error: confirmError })}
          />
          {confirmError && <FieldError id={fieldErrorId(confirmId)}>{confirmError}</FieldError>}
        </FieldRoot>
      )}

      {sentinel !== null && (
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
