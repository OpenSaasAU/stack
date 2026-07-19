import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from '@opensaas/stack-ui'

export const Open = () => (
  <Select defaultOpen defaultValue="published">
    <SelectTrigger style={{ width: 220 }}>
      <SelectValue placeholder="Status" />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectLabel>Publication status</SelectLabel>
        <SelectItem value="draft">Draft</SelectItem>
        <SelectItem value="in-review">In review</SelectItem>
        <SelectItem value="published">Published</SelectItem>
        <SelectItem value="archived">Archived</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
)

export const Selected = () => (
  <Select defaultValue="published">
    <SelectTrigger style={{ width: 220 }}>
      <SelectValue placeholder="Status" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="draft">Draft</SelectItem>
      <SelectItem value="in-review">In review</SelectItem>
      <SelectItem value="published">Published</SelectItem>
      <SelectItem value="archived">Archived</SelectItem>
    </SelectContent>
  </Select>
)

export const WithSeparator = () => (
  <Select defaultValue="us-east-1">
    <SelectTrigger style={{ width: 240 }}>
      <SelectValue placeholder="Region" />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectLabel>Americas</SelectLabel>
        <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
        <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
      </SelectGroup>
      <SelectSeparator />
      <SelectGroup>
        <SelectLabel>Europe</SelectLabel>
        <SelectItem value="eu-west-1">EU West (Ireland)</SelectItem>
        <SelectItem value="eu-central-1">EU Central (Frankfurt)</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
)
