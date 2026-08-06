# PTR Ledger

A static, GitHub Pages-ready ledger of World of Warcraft PTR class tuning. PTR Ledger reads Blizzard's official development-note topic, groups changes by class and specialization, and attaches later revisions to the original change so the current PTR value remains visible without losing its history.

## Features

- Current PTR changes grouped by class and specialization
- Buff, nerf, and changed classifications based on live-to-PTR values
- Revision trails that preserve each announced adjustment and its resulting value versus live
- Cumulative folding for sequential percentage tuning, without confusing a later adjustment with an absolute replacement
- Class submenus; specialization, direction, and source-confirmed talent filters; revised-only filtering; and text search
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

## Talent classification

A change receives the **Talent** tag when Blizzard's note explicitly uses “talent” or “talents,” or when the change is nested beneath an official **Hero Talents** or **Apex Talents** heading. The **Talents only** filter can be combined with class, specialization, buff, nerf, changed, round, revision-history, and text filters.

The updater does not guess from an ability name alone. An unlabelled talent may remain untagged if Blizzard's note supplies neither explicit wording nor a talent container; this conservative rule avoids presenting ordinary spell changes as talents. Once a revision establishes that a change is a talent, later checkpoints retain that classification even if they omit the word.

## How sequential tuning is calculated

Blizzard's weekly PTR posts describe changes applied by that build. PTR Ledger therefore treats a baseline-free statement such as “All ability damage increased by 10%” as a relative adjustment to the current PTR value, not a new absolute value versus live. Sequential relative percentages compound:

```text
combined factor = (1 + adjustment 1) × (1 + adjustment 2) × …
```

For Devourer Demon Hunter, Blizzard first announced [“All ability damage increased by 20%”](https://eu.forums.blizzard.com/en/wow/t/midnight-curse-of-ulatek-ptr-development-notes/621832/1), then included [“All ability damage increased by 10%” in the July 8 weekly tuning update](https://eu.forums.blizzard.com/en/wow/t/midnight-curse-of-ulatek-ptr-development-notes/621832/12). The second note is an additional adjustment:

```text
Live baseline       100
Initial +20%        100 × 1.20 = 120
Later +10%          120 × 1.10 = 132
Combined vs live    +32%
```

A later nerf uses the same rule: `1.20 × 0.90 = 1.08`, so a +20% buff followed by a −10% nerf remains +8% versus live even though the latest adjustment itself is a nerf.

Wowhead also records the July line in its [coverage of that week's separate PTR update](https://www.wowhead.com/news/patch-12-1-ptr-official-development-notes-protection-paladin-talent-adjustments-382118). An [independent Demon Hunter review published after the update](https://www.youtube.com/watch?v=uqwHR7xXGeI) explicitly describes the 10% as “additional”; its “30% flat” description is community shorthand, while applying the two percentages in sequence produces 32%. Blizzard does not publish that cumulative 32% figure directly—it is the ledger's arithmetic result from the two official adjustments.

The updater follows these folding rules:

- Repeated baseline-free `increased by`, `reduced by`, or `decreased by` percentages for the same class, specialization, category, and subject are applied in sequence. Buffs use a positive factor and nerfs a negative factor.
- The announced percentage remains in each history checkpoint as `value`. Its compounded result through that checkpoint is stored as `effectiveValue`. The current card displays the latest effective result, rounded to one decimal place when needed.
- Explicit values such as `increased to 10% (was 8%)` or `adjusted from 8% to 3%` are absolute replacements, not additional multipliers.
- A qualitative replacement clears an obsolete numeric baseline.
- A cumulative overall-damage card describes only that blanket modifier. Separate ability, talent, Mastery, cooldown, and set-bonus changes still affect actual specialization DPS.

Regression coverage for these rules lives in [`test/update-data.test.mjs`](test/update-data.test.mjs).

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
  "slug": "canonical-forum-topic-slug",
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

GitHub Pages is configured to deploy through this workflow with HTTPS enforced. For a fork or a new repository:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions** and run **Update PTR ledger and deploy**, or let a push to `main` trigger it.
4. The deployment URL appears in the workflow's `github-pages` environment.

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
