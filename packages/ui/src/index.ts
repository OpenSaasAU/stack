// Main components
export { AdminUI } from './components/AdminUI.js'
export { Dashboard } from './components/Dashboard.js'
export { Navigation } from './components/Navigation.js'
export { UserMenu } from './components/UserMenu.js'
export { ThemeToggle } from './components/ThemeToggle.js'
export { ThemeScript } from './components/ThemeScript.js'
export { ListView } from './components/ListView.js'
export { ListViewClient } from './components/ListViewClient.js'
export { FilterBuilder } from './components/FilterBuilder.js'
export { RowSelectionBar } from './components/RowSelectionBar.js'
export { ItemForm } from './components/ItemForm.js'
export { ItemFormClient } from './components/ItemFormClient.js'
export { RelationshipTable } from './components/RelationshipTable.js'
export { RelationshipTableClient } from './components/RelationshipTableClient.js'
export { RelationshipCreateDrawer } from './components/RelationshipCreateDrawer.js'
export { SingletonView } from './components/SingletonView.js'
export { ConfirmDialog } from './components/ConfirmDialog.js'
export { LoadingSpinner } from './components/LoadingSpinner.js'
export {
  SkeletonLoader,
  TableSkeleton,
  FormSkeleton,
  PageHeaderSkeleton,
  ListViewSkeleton,
  ItemFormSkeleton,
  DashboardSkeleton,
} from './components/SkeletonLoader.js'
export { PageHeader } from './components/PageHeader.js'
export { EmptyState } from './components/EmptyState.js'

// Status badge primitive (success / warning / destructive tokens)
export { Badge, badgeVariants } from './primitives/badge.js'
export type { BadgeProps } from './primitives/badge.js'

// Initials avatar primitive + its deterministic helpers (issue #735)
export { Avatar } from './primitives/avatar.js'
export type { AvatarProps } from './primitives/avatar.js'
export { getInitials, getAvatarTone, AVATAR_TONES } from './lib/avatar.js'

// Field components
export {
  TextField,
  IntegerField,
  CheckboxField,
  SelectField,
  TimestampField,
  PasswordField,
  RelationshipField,
  FieldRenderer,
  fieldComponentRegistry,
  registerFieldComponent,
  getFieldComponent,
  FieldRoot,
  FieldLabel,
  FieldHelp,
  FieldError,
  FieldWarning,
  FieldReadValue,
} from './components/fields/index.js'

// Cell components + registry (list-table rendering of field values)
export {
  TextCell,
  IntegerCell,
  CheckboxCell,
  SelectCell,
  TimestampCell,
  RelationshipCell,
  AvatarLabelCell,
  CellRenderer,
  cellComponentRegistry,
  registerCellComponent,
  getCellComponent,
} from './components/cells/index.js'
export type { CellComponent, CellComponentProps } from './components/cells/index.js'

// Types
export type { AdminUIProps } from './components/AdminUI.js'
export type { DashboardProps } from './components/Dashboard.js'
export type { NavigationProps } from './components/Navigation.js'
export type { UserMenuProps } from './components/UserMenu.js'
export type { ThemeToggleProps } from './components/ThemeToggle.js'
export type { ListViewProps } from './components/ListView.js'
export type { ListViewClientProps } from './components/ListViewClient.js'
export type { FilterBuilderProps, FilterBuilderClassNames } from './components/FilterBuilder.js'
export type {
  RowSelectionBarProps,
  RowSelectionBarClassNames,
} from './components/RowSelectionBar.js'
export type { ItemFormProps } from './components/ItemForm.js'
export type { ItemFormClientProps } from './components/ItemFormClient.js'
export type { RelationshipTableProps } from './components/RelationshipTable.js'
export type { RelationshipTableClientProps } from './components/RelationshipTableClient.js'
export type { RelationshipCreateDrawerProps } from './components/RelationshipCreateDrawer.js'

// Item-view layout derivation (shape → details card + Relationship tables)
export { deriveItemViewLayout } from './lib/deriveItemView.js'
export type {
  ItemViewLayout,
  ItemViewArrangement,
  RelationshipTableSection,
} from './lib/deriveItemView.js'
export type { SingletonViewProps } from './components/SingletonView.js'
export type { ConfirmDialogProps } from './components/ConfirmDialog.js'
export type { LoadingSpinnerProps } from './components/LoadingSpinner.js'
export type { SkeletonLoaderProps } from './components/SkeletonLoader.js'
export type { PageHeaderProps, PageHeaderClassNames } from './components/PageHeader.js'
export type { EmptyStateProps, EmptyStateClassNames } from './components/EmptyState.js'

export type {
  TextFieldProps,
  IntegerFieldProps,
  CheckboxFieldProps,
  SelectFieldProps,
  TimestampFieldProps,
  PasswordFieldProps,
  RelationshipFieldProps,
  FieldRendererProps,
  FieldComponent,
  FieldComponentProps,
} from './components/fields/index.js'

// Standalone composable components
export {
  ItemCreateForm,
  ItemEditForm,
  ListTable,
  SearchBar,
  DeleteButton,
} from './components/standalone/index.js'

export type {
  ItemCreateFormProps,
  ItemEditFormProps,
  ListTableProps,
  ListTableClassNames,
  SearchBarProps,
  SearchBarClassNames,
  DeleteButtonProps,
  DeleteButtonClassNames,
  ItemFormClassNames,
} from './components/standalone/index.js'

// Utility functions
export {
  cn,
  formatListName,
  formatFieldName,
  getFieldDisplayValue,
  isNumericField,
} from './lib/utils.js'

// Relationship-options read primitive (re-exported from @opensaas/stack-core)
export { getRelationshipOptions } from './lib/getRelationshipOptions.js'
export type { RelationshipOption, RelationshipOptionsArgs } from './lib/getRelationshipOptions.js'

// Row selection (list-table Bulk actions)
export {
  useRowSelection,
  isPageFullySelected,
  getPageCheckboxState,
} from './lib/useRowSelection.js'
export type { RowSelection } from './lib/useRowSelection.js'

// Filter builder state helpers (UI state <-> `?search=` query round-trip)
export { queryToState, stateToQuery } from './lib/filterBuilderState.js'
export type { FilterRow, FilterBuilderState } from './lib/filterBuilderState.js'

// Theme utilities
export { compileTheme, presetThemes } from './lib/theme.js'

// Color-scheme (dark mode) utilities
export {
  type ThemeChoice,
  THEME_STORAGE_KEY,
  themeInitScript,
  applyThemeChoice,
  readStoredChoice,
} from './lib/theme-mode.js'
