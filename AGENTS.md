# AGENTS.md

## Scope

These instructions apply to the entire repository.

PTR Ledger is a static World of Warcraft PTR class-tuning tracker. Preserve its core contract: show the latest effective PTR change while retaining every official revision that led to it.

## Project map

- `config/sources.json` — tracked Blizzard PTR forum topics
- `scripts/update-data.mjs` — source fetching, parsing, classification, revision folding, and generated output
- `test/update-data.test.mjs` — observable parser and revision-history contracts
- `site/index.html` — static document structure
- `site/app.js` — filtering, navigation, and change-card rendering
- `site/styles.css` — responsive visual system
- `site/data/patches.json` — generated updater output
- `.github/workflows/pages.yml` — scheduled data refresh and GitHub Pages deployment

## Commands

```bash
npm ci
npm test
npm run update
npm run serve
```

Node.js 22 or newer is required.

## Repository rules

- Use Blizzard's official forum topic API as the source of truth. Do not replace it with scraped Wowhead markup.
- Never hand-edit `site/data/patches.json`; update `config/sources.json` or `scripts/update-data.mjs`, then run `npm run update`.
- Keep older patch-source entries so historical patch data and revision trails remain available.
- Treat class, specialization, subject, current value, baseline, direction, and history as one data contract. Parser changes must preserve all affected fields.
- A later tuning note for the same effect updates the displayed current value and appends a history checkpoint; it must not create an unrelated duplicate card.
- Keep site asset and data URLs relative so the project works under the `/PTRLedger/` GitHub Pages subpath.
- Keep the browser application framework-free unless the project requirements materially change.
- Do not commit `node_modules/` or local tooling output.

## Publishing approval

- Never push commits or tags to a remote, manually dispatch a deployment, or rerun a deployment workflow without the user's explicit confirmation immediately before publishing.
- Always create a local commit after completing a feature or any other repository change; do not wait for the user to request the commit. A local commit does not authorize a push.
- A request to implement or commit changes does not authorize a push to the live build. Keep the work local, report the completed changes and verification, then ask whether to publish.
- After approval, push only the reviewed commits described to the user. New changes require new approval.

## Verification

- Parser, classifier, or updater changes: run `npm test`, then `npm run update` and inspect the affected generated entry.
- UI behavior changes: run `npm run serve` and exercise the changed flow in a browser at desktop and relevant mobile widths.
- Workflow changes: validate the YAML structure and preserve `pages: write`, `id-token: write`, the `github-pages` environment, artifact upload, and deployment steps.
- Before committing, ensure generated data is current and no dependency or temporary directories are staged.
