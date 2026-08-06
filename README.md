# PTR Ledger

A static, GitHub Pages-ready ledger of World of Warcraft PTR class tuning. PTR Ledger reads Blizzard's official development-note topic, groups changes by class and specialization, and attaches later revisions to the original change so the current PTR value remains visible without losing its history.

## Features

- Current PTR changes grouped by class and specialization
- Distinct buff, nerf, fix, and changed classifications using official bugfix wording and live-to-PTR values
- Revision trails that preserve each announced adjustment and its resulting value versus live
- Cumulative folding for sequential percentage tuning, without confusing a later adjustment with an absolute replacement
- Explicit PvP-scope metadata and a filter for changes that do not affect PvP combat
- Links from every change and revision to the official Blizzard forum note
- On-demand, side-by-side Live and PTR spell tooltips on resolved ability names
- Responsive static HTML, CSS, and JavaScript with no runtime backend
- Automated refresh and GitHub Pages deployment every six hours

## GitHub Pages URL

After Pages is enabled and the first workflow succeeds, the site will be available at:

<https://mathwro-wow.github.io/PTRLedger/>

## Data source

Patch sources are configured in [`config/sources.json`](config/sources.json). PTR history uses Blizzard's official Discourse topic API. Final release snapshots may use Blizzard's official news article HTML; neither path uses Wowhead's presentation layer as the source of truth.

The tracked sources are the [Midnight 12.1 — Curse of Ula'tek PTR development notes](https://eu.forums.blizzard.com/en/wow/t/midnight-curse-of-ulatek-ptr-development-notes/621832) and Blizzard's [Curse of Ula'tek Content Update Notes](https://worldofwarcraft.blizzard.com/en-us/news/24293281).

Generated output is stored in `site/data/patches.json`. Do not edit that file manually; run the updater instead.

## Talent and ability metadata

Blizzard's official note structure remains authoritative: explicit “talent” wording and changes beneath **Hero Talents** or **Apex Talents** are always tagged **Talent**. The updater supplements that signal with Raidbots' current [PTR talent-tree dataset](https://www.raidbots.com/static/data/ptr/talents.json), which is generated from World of Warcraft client data. A class and specialization-scoped subject that equals a tree-node name—or starts with the longest matching name for a property-specific note—is resolved to that node. Selectable nodes are tagged **Talent**; a node marked free for that specialization is tagged **Spell** instead.

Resolved entries include their canonical ability name, spell ID, and icon identifier. Baseline spells and named child effects absent from the talent-tree export use a small class/spec-scoped supplemental table verified against current client `SpellName` and `SpellMisc` data; this also maps the standard Auto Attack spell. Remaining unresolved subjects use Wowhead's JSON search at build time, accepting only exact spell-name matches, preferring class-specific evidence, and rejecting ambiguous icons. Search results and misses for the current note revision are cached in `site/data/ability-metadata.json`; the browser makes no metadata request. Multi-rank nodes select the announced rank, or rank 1 when a note names only the overall talent. Icons are downloaded from Blizzard's render service into `site/assets/abilities/`, with Wowhead's icon CDN used only when a PTR-only icon is unavailable there. Source-confirmed talent classification overrides a free-node classification. Ambiguous or unresolved names remain untyped and iconless rather than receiving a guessed match. Once a revision establishes that a change is a talent, later checkpoints retain that classification even if they omit the word.

Cards with a resolved spell ID expose an on-demand **Live ↔ PTR** comparison using [Wowhead tooltip data](https://www.wowhead.com/tooltips). Each pane's **Wowhead ↗** label opens the corresponding Live or PTR spell page. The browser requests tooltip JSON only when the user hovers, focuses, or opens an ability name; no Wowhead script or advertising is embedded. Tooltip data is supplementary and may lag behind Blizzard's latest PTR notes. The linked official-note text and revision history remain authoritative.

The **Talents only** filter can be combined with class, specialization, buff, nerf, fix, changed, round, revision-history, PvP-scope, and text filters. The PvP filter hides only notes that explicitly state the change does not apply to or affect PvP, or remains unchanged in PvP; unspecified notes remain visible because the official note does not establish their PvP scope.

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
- Final release-note articles are configured as separate `LIVE` patch sources, so their values are built from that article alone. A final value such as Devourer's `+32%` is not compounded again with the earlier PTR checkpoints; the older `PTR` source remains available for its revision history.

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

## Adding another patch source

Retain existing entries in `config/sources.json` so their history remains available, then append either a PTR forum source or an independent final article source.

PTR forum source:

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

Final release article:

```json
{
  "id": "12.2-live",
  "name": "Patch name — Live",
  "type": "article",
  "url": "https://worldofwarcraft.blizzard.com/en-us/news/123456789",
  "checkpoint": "final",
  "status": "LIVE",
  "current": true
}
```

Use a separate `*-live` ID for a final article. Set the older snapshot's `current` field to `false`, run `npm run update`, and verify the generated patch selector and class data locally. This keeps final article values independent from earlier PTR cumulative checkpoints.

## GitHub Pages deployment

The workflow at [`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs on:

- Pushes to `main` that change `site/`, updater scripts or configuration, or the npm manifests
- A six-hour schedule
- Manual workflow dispatch

It installs dependencies, runs the tests, refreshes the official notes, and commits changed generated data. Scheduled runs with no generated-data difference stop before Pages configuration, artifact upload, and deployment; qualifying pushes and manual dispatches deploy `site/`.

GitHub Pages is configured to deploy through this workflow with HTTPS enforced. For a fork or a new repository:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions** and run **Update PTR ledger and deploy**, or push a matching website or updater change to `main`.
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

## License

The original PTR Ledger source code, site code, tests, configuration, and documentation are licensed under the [MIT License](LICENSE) © 2026 Mathias Wrobel.

The MIT License does not grant rights to Blizzard Entertainment's World of Warcraft names, trademarks, game content, official note text, or imagery, including the locally served class icons. Those materials remain subject to their respective owners' terms. PTR Ledger is an unofficial tracker and is not endorsed by or affiliated with Blizzard Entertainment. External dependencies and linked data services retain their own licenses and terms.
