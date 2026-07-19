import { RelationshipField } from '@opensaas/stack-ui'

const noop = () => {}

const authors = [
  { id: 'usr_ada', label: 'Ada Lovelace' },
  { id: 'usr_grace', label: 'Grace Hopper' },
  { id: 'usr_alan', label: 'Alan Turing' },
]

const tags = [
  { id: 'tag_eng', label: 'Engineering' },
  { id: 'tag_design', label: 'Design' },
  { id: 'tag_product', label: 'Product' },
  { id: 'tag_ops', label: 'Operations' },
]

export const Single = () => (
  <div style={{ maxWidth: 360 }}>
    <RelationshipField
      name="author"
      label="Author"
      value="usr_grace"
      onChange={noop}
      items={authors}
    />
  </div>
)

export const ManyConnected = () => (
  <div style={{ maxWidth: 420 }}>
    <RelationshipField
      name="tags"
      label="Tags"
      value={['tag_eng', 'tag_product']}
      onChange={noop}
      items={tags}
      many
    />
  </div>
)

export const ManyEmpty = () => (
  <div style={{ maxWidth: 420 }}>
    <RelationshipField
      name="tags"
      label="Tags"
      value={[]}
      onChange={noop}
      items={tags}
      many
      required
    />
  </div>
)

export const WithError = () => (
  <div style={{ maxWidth: 360 }}>
    <RelationshipField
      name="author"
      label="Author"
      value=""
      onChange={noop}
      items={authors}
      required
      error="Please select an author for this post."
    />
  </div>
)

export const ReadMode = () => (
  <div style={{ maxWidth: 420 }}>
    <RelationshipField
      name="tags"
      label="Tags"
      value={['tag_eng', 'tag_design']}
      onChange={noop}
      items={tags}
      many
      mode="read"
    />
  </div>
)
