# Working in this repository

A proof-of-concept host for autonomous agents that work on computers: a test console
(`apps/sample`), the embeddable computer viewer package (`packages/computer-viewer`), a standalone
viewer page (`apps/viewer`) and a test sign-in page with a fixed one-time code (`apps/otp-page`).
The console talks only to a run API through its own dev server; no secret reaches the browser.

## Rules
- This repository is public. Never commit secrets, real hosts, account ids, personal data or
  paths from a developer machine. Tests use fixture values that say so.
- Stack: Vite, React 19, TypeScript, Tailwind CSS 4, shadcn/ui components added with the shadcn
  CLI from the official registry only. Exact dependency versions, at least two weeks old.
- Minimal UI copy: no explainer paragraphs; accessible names on controls.
- Reuse what exists; delete code a change makes dead; one source of truth.
- Catalogs (`apps/sample/src/catalog/*.json`) hold templates, tools and scenarios; extend them
  rather than hard-coding in components.
- Every change ships with tests (vitest + testing-library) and updates the docs it affects.

## Gate (must pass before you finish)
```
npm ci
npm run typecheck
npm test
npm run build
```

## Pull requests
Say why the change exists, what changed and how it was tested, in words. Keep one task per pull
request. If the brief is unclear or contradicts these rules, ask in the issue instead of guessing.
