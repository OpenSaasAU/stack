// Main components
export { AdminUI } from './components/AdminUI.js'
export { Dashboard } from './components/Dashboard.js'
export { Navigation } from './components/Navigation.js'
export { ListView } from './components/ListView.js'
export { ListViewClient } from './components/ListViewClient.js'
export { ItemForm } from './components/ItemForm.js'
export { ItemFormClient } from './components/ItemFormClient.js'
export { ConfirmDialog } from './components/ConfirmDialog.js'
export { LoadingSpinner } from './components/LoadingSpinner.js'
export { SkeletonLoader, TableSkeleton, FormSkeleton } from './components/SkeletonLoader.js'

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
} from './components/fields/index.js'

// Types
export type { AdminUIProps } from './components/AdminUI.js'
export type { DashboardProps } from './components/Dashboard.js'
export type { NavigationProps } from './components/Navigation.js'
export type { ListViewProps } from './components/ListView.js'
export type { ListViewClientProps } from './components/ListViewClient.js'
export type { ItemFormProps } from './components/ItemForm.js'
export type { ItemFormClientProps } from './components/ItemFormClient.js'
export type { ConfirmDialogProps } from './components/ConfirmDialog.js'
export type { LoadingSpinnerProps } from './components/LoadingSpinner.js'
export type { SkeletonLoaderProps } from './components/SkeletonLoader.js'

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
  SearchBarProps,
  DeleteButtonProps,
} from './components/standalone/index.js'

// Utility functions
export { cn, formatListName, formatFieldName, getFieldDisplayValue } from './lib/utils.js'

// Theme utilities
export { generateThemeCSS, getThemeStyleTag, presetThemes } from './lib/theme.js'

// Filter components and utilities
export { FilterBar } from './components/filters/index.js'
export type { FilterBarProps, FilterableField } from './components/filters/index.js'

export {
  TextFilterInput,
  NumberFilterInput,
  BooleanFilterInput,
  DateFilterInput,
  SelectFilterInput,
  RelationshipFilterInput,
} from './components/filters/index.js'

export type {
  FilterInputBaseProps,
  TextFilterInputProps,
  NumberFilterInputProps,
  BooleanFilterInputProps,
  DateFilterInputProps,
  SelectFilterInputProps,
  RelationshipFilterInputProps,
} from './components/filters/index.js'

// Filter types and utilities
export type {
  FilterOperator,
  FilterCondition,
  ListFilters,
  FilterURLState,
} from './lib/filter-types.js'

export { FIELD_TYPE_OPERATORS, OPERATOR_LABELS } from './lib/filter-types.js'

export {
  parseFiltersFromURL,
  serializeFiltersToURL,
  filtersToPrismaWhere,
  addFilter,
  removeFilter,
  removeFieldFilters,
  getFieldFilters,
  clearFilters,
} from './lib/filter-utils.js'
