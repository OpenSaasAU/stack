export { SignInForm } from './components/SignInForm.js'
export { SignUpForm } from './components/SignUpForm.js'
export { ForgotPasswordForm } from './components/ForgotPasswordForm.js'
export { ResetPasswordForm } from './components/ResetPasswordForm.js'

export type { SignInFormProps } from './components/SignInForm.js'
export type { SignUpFormProps } from './components/SignUpForm.js'
export type { ForgotPasswordFormProps } from './components/ForgotPasswordForm.js'
export type { ResetPasswordFormProps } from './components/ResetPasswordForm.js'

// Auth action contract types — the agreement between the forms and the
// app-owned server actions they invoke.
export type {
  AuthActionResult,
  SignInInput,
  SignUpInput,
  RequestPasswordResetInput,
  ResetPasswordInput,
  SignInAction,
  SignUpAction,
  RequestPasswordResetAction,
  ResetPasswordAction,
  SignInSocialAction,
} from './types.js'
