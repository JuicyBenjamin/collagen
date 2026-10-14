---
name: folder-structure
description: Use when creating, moving, splitting or renaming a component or file in collagen's UI code (apps/review-web/src, apps/cli/src/ui), or when asked where something should live. A component with children is a folder with its own components/ and an index.ts; children are named without repeating their parent.
---

# Folder structure

The folders mirror the tree on screen: open a component's folder and its
children are there, nowhere else.

## The rule

- **A component with no children is one file** in its parent's
  `components/`: `components/Progress.tsx`.
- **A component with children is a folder named after it:** its own file,
  an `index.ts` re-exporting it (imports name the folder, not the file),
  and `components/` for its children. The same, all the way down.

```
components/
  Page/
    index.ts            ← export { Page } from "./Page"
    Page.tsx
    components/
      Header/
        index.ts
        Header.tsx
        components/
          HostBar/
            index.ts
            HostBar.tsx
            components/
              Progress.tsx
              Pull.tsx
              Viewer.tsx
      Outline.tsx
```

- **Children live under the component that renders them,** never beside
  it. A dispatcher is the parent of its variants.
- **Shared children go to the nearest common ancestor's `components/`,**
  not duplicated, not pushed higher. Primitives every part uses (`Arrives`,
  `Appear`) sit at the top `components/`.
- **`components/` only.** No `parts/`, `sections/`, `views/`.
- **No repeated ancestry in names.** Inside `HostBar/components/` the
  viewer is `Viewer.tsx`, not `HostBarViewer.tsx`. Only a folder's own
  entry file carries the folder's name.
- **Non-UI modules stay out of component folders** unless one component
  alone uses them: state shared across the page (`hostNow.ts`,
  `viewedNow.ts`), the data's types (`data.ts`), server functions.

## Checklist

- [ ] Does the component render children? Then it is a folder with
      `index.ts` and `components/`.
- [ ] Is every child under the component that renders it?
- [ ] Is a shared child at the nearest common ancestor?
- [ ] Does any name repeat its folder?
