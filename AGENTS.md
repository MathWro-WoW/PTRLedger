# AGENTS.md

## Scope

These instructions apply to the entire repository.

PTR Ledger is a static World of Warcraft PTR class-tuning tracker. Preserve its core contract: show the latest effective PTR change while retaining every official revision that led to it.

## Project map

- `config/sources.json` — tracked Blizzard PTR forum topic IDs and official final-note article URLs
- `scripts/update-data.mjs` — source fetching, parsing, classification, absolute replacement, cumulative tuning, revision folding, and generated output
- `test/update-data.test.mjs` — observable parser, value-semantics, and revision-history contracts
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

- Use Blizzard's official Discourse topic API for PTR history and Blizzard's official news article HTML for final snapshots. Do not replace either source with scraped Wowhead markup.
- Never hand-edit `site/data/patches.json` or `site/data/ability-metadata.json`; update `config/sources.json` or `scripts/update-data.mjs`, then run `npm run update`.
- Keep older patch-source entries so historical patch data and revision trails remain available.
- Treat class, specialization, category, talent classification, ability type, canonical ability name, spell ID, icon, subject, current value, latest adjustment, baseline, direction, cumulative state, effective checkpoint value, and history as one data contract. Parser changes must preserve all affected fields.
- Fold a later note into the same card only when its class, specialization, category, and subject identity match. Always append its official history checkpoint.
- Blizzard's explicit `talent`/`talents` wording and `Hero Talents` or `Apex Talents` source structure are authoritative. Supplement those signals with a class and specialization-scoped match from Raidbots' PTR talent-tree dataset: prefer an exact subject, then the longest node-name prefix for a property-specific subject. Multi-rank nodes use the announced rank, or rank 1 when no rank is named. Baseline spells and named child effects absent from that dataset may use a narrow supplemental record only when their spell ID and icon are verified against current client data. Remaining names may use Wowhead's JSON search only as build-time metadata: require an exact spell name, prefer class-specific evidence, reject conflicting icon matches, and cache both results and current-revision misses. A selectable tree node is a talent; a node marked `freeNode` or a resolved spell record is a spell. Source-confirmed talent status overrides metadata, and unresolved names remain untyped rather than guessed. Once established, preserve talent classification through later revisions that omit the label.
- Keep runtime Wowhead tooltip comparisons on-demand and supplementary. Always state that PTR tooltip data may lag behind Blizzard's latest PTR notes; never use tooltip data to rewrite the official-note ledger.
- Treat a baseline-free single percentage stated as `increased by`, `reduced by`, or `decreased by` as relative to that PTR build. When every checkpoint for an identity has this form, calculate the value versus live by multiplying the factors: `combined = product(1 + signed adjustment) - 1`. Never add the announced percentages.
- Preserve each announced delta as the history item's `value`; store the compounded result through that checkpoint as `effectiveValue`. The current card uses the latest effective result, rounded to one decimal place when necessary.
- Treat a final release-note article configured under a patch's `finalSource` as an independent `LIVE` checkpoint merged into that same patch's round history. Never feed its values back into preceding PTR cumulative math; preserve the PTR checkpoints and record the final value as its own effective result. Within a final article source, explicit `increased to … (was …)`, `reduced to … (was …)`, and `adjusted from … to …` wording remains an absolute replacement, not a cumulative multiplier. A qualitative replacement clears an obsolete numeric baseline.
- A cumulative overall-damage value covers only that blanket modifier; never present it as total specialization DPS when separate ability, talent, Mastery, cooldown, or set-bonus changes also apply.
- Keep the derivation, worked Devourer example, and evidence links in README's “How sequential tuning is calculated” section current whenever these rules change.
- Evidence for the current rule: Blizzard's [initial +20% Devourer note](https://eu.forums.blizzard.com/en/wow/t/midnight-curse-of-ulatek-ptr-development-notes/621832/1), its [later +10% weekly update](https://eu.forums.blizzard.com/en/wow/t/midnight-curse-of-ulatek-ptr-development-notes/621832/12), [Wowhead's separate update coverage](https://www.wowhead.com/news/patch-12-1-ptr-official-development-notes-protection-paladin-talent-adjustments-382118), and an [independent review calling the 10% “additional”](https://www.youtube.com/watch?v=uqwHR7xXGeI). Blizzard does not publish `+32%`; that figure is derived by applying `1.20 × 1.10`.
- Keep the browser application framework-free unless the project requirements materially change.
- Do not commit `node_modules/` or local tooling output.

## Publishing approval

- Never push commits or tags to a remote, manually dispatch a deployment, or rerun a deployment workflow without the user's explicit confirmation immediately before publishing.
- Always create a local commit after completing a feature or any other repository change; do not wait for the user to request the commit. A local commit does not authorize a push.
- A request to implement or commit changes does not authorize a push to the live build. Keep the work local, report the completed changes and verification, then ask whether to publish.
- After approval, push only the reviewed commits described to the user. New changes require new approval.

## Verification

- Parser, classifier, or updater changes: run `npm test`, then `npm run update` and inspect the affected generated entry. Talent-classification changes must cover explicit wording, structural containers, ordinary selectable talents, free abilities, and later revisions. Metadata changes must also inspect canonical name, spell ID, local icon path, and an unresolved entry.
- UI behavior changes: run `npm run serve` and exercise the changed flow in a browser at desktop and relevant mobile widths. Ability icons are decorative beside an existing text label, must use an empty alt value, and must remain locally served.
- Cumulative-folding changes: test at least buff→buff and buff→nerf sequences, confirm explicit `was` replacements still replace, run `npm run update`, and inspect `value`, `latestAdjustment`, `effectiveValue`, and canonical history links in the generated entry.
- Workflow changes: validate the YAML structure and preserve `pages: write`, `id-token: write`, the `github-pages` environment, artifact upload, and deployment steps.
- Before committing, ensure generated data is current and no dependency or temporary directories are staged.
