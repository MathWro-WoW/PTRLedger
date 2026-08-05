# PTR Ledger

A static, GitHub Pages-ready ledger of World of Warcraft PTR class tuning. PTR Ledger reads Blizzard's official development-note topic, groups changes by class and specialization, and attaches later revisions to the original change so the current PTR value remains visible without losing its history.

## Features

- Current PTR changes grouped by class and specialization
- Buff, nerf, and changed classifications based on live-to-PTR values
- Revision trails when Blizzard adjusts a change in a later note round
- Class submenus, specialization and direction filters, revised-only filtering, and text search
- Links from every change and revision to the official Blizzard forum note
- Responsive static HTML, CSS, and JavaScript with no runtime backend
- Automated refresh and GitHub Pages deployment every six hours

## GitHub Pages URL

After Pages is enabled and the first workflow succeeds, the site will be available at:

<https://mathwro-wow.github.io/PTRLedger/>

## Data source

Patch sources are configured in [`config/sources.json`](config/sources.json). The updater fetches Blizzard's official Discourse topic API rather than scraping the Wowhead presentation layer.

The current source is the [Midnight 12.1 — Curse of Ula'tek PTR development notes](https://eu.forums.blizzard.com/en/wow/t/midnight-curse-of-ulatek-ptr-development-notes/621832).

Generated output is stored in `site/data/patches.json`. Do not edit that file manually; run the updater instead.

## Local development

### Requirements

- Node.js 22 or newer
- npm

### Install and run

```bash
npm ci
npm test
npm run update
npm run serve
```

`npm run serve` serves the `site/` directory. Open the local URL printed by `serve`.

### Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run parser, classification, and revision-folding regression tests |
| `npm run update` | Fetch configured Blizzard topics and regenerate `site/data/patches.json` |
| `npm run serve` | Preview the static site locally |

## Adding another PTR patch

Retain existing entries in `config/sources.json` so their history remains available, then append the new source:

```json
{
  "id": "12.2",
  "name": "Patch name",
  "topicId": 123456,
  "region": "eu",
  "status": "PTR",
  "current": true
}
```

Set the older patch's `current` field to `false`, run `npm run update`, and verify the generated patch selector and class data locally.

## GitHub Pages deployment

The workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs on:

- Every push to `main`
- A six-hour schedule
- Manual workflow dispatch

It installs dependencies, runs the tests, refreshes the official notes, commits changed generated data, uploads `site/` as the Pages artifact, and deploys it.

To enable the deployment:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions** and run **Update PTR ledger and deploy**, or let a push to `main` trigger it.
4. The deployment URL appears in the workflow's `github-pages` environment.

The repository is currently private. GitHub Pages availability for a private organization repository depends on the organization's GitHub plan. If Pages is unavailable under the current plan, make the repository public or upgrade the organization plan.

The workflow requests repository contents write access for generated data, Pages write access, and an OpenID Connect token for deployment. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Project structure

```text
.github/workflows/pages.yml  Scheduled updater and Pages deployment
config/sources.json          PTR topics to track
scripts/update-data.mjs      Forum parser, classifier, and revision folder
site/                        Static website and generated data
site/assets/classes/         Locally served class icons
test/update-data.test.mjs    Parser and tuning regression tests
```

## Data and attribution

World of Warcraft and related names and imagery are trademarks of Blizzard Entertainment. PTR Ledger is an unofficial change-tracking interface. Change text is linked back to Blizzard's official forum posts.
