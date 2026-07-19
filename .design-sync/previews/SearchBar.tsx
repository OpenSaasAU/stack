import { SearchBar } from '@opensaas/stack-ui'

const noop = () => {}

export const Default = () => (
  <div style={{ maxWidth: 520 }}>
    <SearchBar
      onSearch={noop}
      onClear={noop}
      placeholder="Search posts by title or author..."
      searchLabel="Search"
    />
  </div>
)

export const WithValue = () => (
  <div style={{ maxWidth: 520 }}>
    <SearchBar
      onSearch={noop}
      onClear={noop}
      placeholder="Search posts..."
      defaultValue="release notes"
      searchLabel="Search"
    />
  </div>
)
