// Preview-only wrapper (wired via cfg.provider). The DS's tokens use CSS
// `light-dark()` driven by `color-scheme`; with no pinned `data-theme` the
// default `:root { color-scheme: light dark }` follows the VIEWER's OS
// preference. The claude.ai/design pane draws every card on a white canvas,
// so a dark-mode viewer would get near-white `text-foreground` on white
// (unreadable). Pinning the preview root to `light` keeps cards readable on
// that white canvas regardless of the viewer's OS theme. This wraps ONLY the
// preview cards — it does not change the shipped bundle or how real designs
// render (those should pin their own theme; see the README conventions).
import * as React from 'react'

export function DsPreviewLight({ children }: { children?: React.ReactNode }) {
  return React.createElement('div', { style: { colorScheme: 'light' } }, children)
}
