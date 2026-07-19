import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxSearch,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@opensaas/stack-ui'

const noop = () => {}

export const Open = () => (
  <Combobox defaultOpen>
    <ComboboxTrigger style={{ width: 260 }}>Assign reviewer…</ComboboxTrigger>
    <ComboboxContent style={{ width: 260 }}>
      <ComboboxSearch placeholder="Search people…" value="" onChange={noop} />
      <ComboboxList>
        <ComboboxItem selected>Jordan Lee</ComboboxItem>
        <ComboboxItem>Priya Nair</ComboboxItem>
        <ComboboxItem>Marcus Chen</ComboboxItem>
        <ComboboxItem>Sofia Alvarez</ComboboxItem>
        <ComboboxItem>Diego Fernandez</ComboboxItem>
      </ComboboxList>
    </ComboboxContent>
  </Combobox>
)

export const Empty = () => (
  <Combobox defaultOpen>
    <ComboboxTrigger style={{ width: 260 }}>Search frameworks…</ComboboxTrigger>
    <ComboboxContent style={{ width: 260 }}>
      <ComboboxSearch placeholder="Search frameworks…" value="qwerty" onChange={noop} />
      <ComboboxList>
        <ComboboxEmpty>No frameworks found.</ComboboxEmpty>
      </ComboboxList>
    </ComboboxContent>
  </Combobox>
)
