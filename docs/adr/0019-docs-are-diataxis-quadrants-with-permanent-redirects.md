# Docs are organized as Diátaxis quadrants, with permanent redirects from the old URLs

The docs site's original IA (Getting Started / Core Concepts / Packages / Guides / API Reference) had grown a flat, unordered 14-item Guides pile, mixed-purpose package pages, and no learning path. As part of the website redesign we chose a full Diátaxis restructure — Tutorials / How-to guides / Concepts / Reference, every page having exactly one of those four jobs — over the cheaper alternative of curating the existing structure in place. Per-package pages live under Reference; their conceptual and setup material belongs in Concepts and How-to respectively.

Re-slugging published URLs is the meaningful cost: every pre-restructure URL is preserved as a permanent redirect in `docs/next.config.js`, and that redirect table must be extended — never pruned — if pages move again.

## Considered Options

- **Curate in place** (keep URLs, group the Guides pile, add a docs landing) — rejected: it preserves the mixed-purpose pages and leaves the IA without a real learning path, which the Flagship tutorial requires.
- **Full Diátaxis restructure** — chosen, accepting the redirect debt as a one-time cost.
