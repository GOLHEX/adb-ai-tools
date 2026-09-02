---
name: adobe-stock-portfolio
description: Audit and re-optimize an Adobe Stock contributor portfolio at scale — harvest published works with their metadata, download previews, review them visually in contact sheets, rewrite titles and keywords so they match the actual image and name a commercial use case, and apply the changes programmatically by media_id. Also builds a theme registry that maps what is in the portfolio to what actually earned. Use this whenever someone mentions Adobe Stock, a stock portfolio, contributor earnings, bulk editing titles or keywords on already-published stock assets, "Similar auto rejected" moderation, or asks why their stock income is falling and what to generate next. Reach for it even when they only say "my portfolio isn't selling" or "fix my keywords" without naming Adobe.
---

# Adobe Stock portfolio audit and re-optimization

Contributors with tens of thousands of published assets face two problems that look like one:
the metadata is wrong, and the content mix is wrong. This skill separates them. Fixing metadata
is cheap and mechanical; fixing the content mix requires knowing what the portfolio actually
contains and what actually sells — which nobody knows, because nobody has looked at 40,000
images. The audit produces that answer as a by-product of the repair work.

Adobe gives contributors no bulk-edit tool for published assets. The save action is a single
JSON POST, so a few hundred works an hour is achievable once the mechanics are set up.
The real bottleneck is deciding what each title and keyword set should say.

## The loop

One pass covers 5 portfolio pages (500 works). Everything except writing the metadata is
scripted in `scripts/adobe_edit.js` — a dependency-free Node tool that drives Chrome over the
DevTools Protocol.

```
1. Chrome with --remote-debugging-port=9222, logged in, portfolio open
2. node adobe_edit.js --harvest 6 10     harvest 5 pages: ids, uuids, categories,
                                          filenames, current metadata + 500px previews
3. node adobe_edit.js --sheets            build contact sheets of 20 works each,
                                          skipping anything sold or already edited
4. Look at every sheet. Write metadata from the image.
5. node adobe_edit.js --apply block.csv --dry     inspect the request bodies
6. node adobe_edit.js --apply block.csv           live run, ~3s per work
7. Append the works to the theme registry, rebuild the theme table
```

Work in blocks of 40 (two contact sheets). Smaller and the overhead dominates; larger and
title quality drops because you lose track of what you already wrote.

Read `references/edit-mechanics.md` before the first run — it explains the endpoint, why the
`contentUuid` is per-asset, and why the CSRF token cannot be cached.

## Look at the images. The old metadata lies.

This is the part people skip and it invalidates everything downstream. AI-generated titles
already in a portfolio describe the wrong thing at a startling rate — a pile of black stones
titled "a symbolic representation of financial growth", broken glass titled "abstract pattern".
Rewriting from the existing text just launders the error into better prose.

The contact sheets exist so that reviewing 500 images costs 25 glances instead of 500. Each
sheet is labeled with media_ids and `sheets/index.csv` records exactly which ids are on which
sheet, so there is no guessing.

## Writing titles and keywords

Full rules with examples in `references/metadata-rules.md`. The short version:

A title has three blocks — **subject with its defining detail**, **composition or format**,
**two or three application niches**. The last block is what people get wrong. A buyer does not
search for what is depicted, they search for what they can use. "Cracked glass starburst on
black" is a description; "Cracked glass starburst glowing on black surface, ideal for security
branding, tech covers and film title cards" is findable.

Keyword count is **8–34, decided by the frame**, not a fixed quota. A single object on a plain
background genuinely has eight facets; padding it to twenty adds noise that dilutes the ten
positions that matter. A scene with people, a setting and an action can honestly carry thirty.
At least a third of every list should answer "what will this be bought for" — industry, medium,
campaign type — rather than "what is in the picture".

The 70-character no-comma limit applies to **CSV import only**. This channel is the same one
the web UI uses, so titles run to full length with commas, which is the form the highest-earning
assets in a mature portfolio actually have.

## Three rules that protect the portfolio

The script enforces all three; do not disable them casually.

**Never edit a work that has sold.** It already found its buyer and holds a position in search.
Editing resets accumulated signals to test a hypothesis — the downside outweighs the upside.
The script reads a lifetime-sales CSV and refuses to run without it.

**Never edit the same work twice.** `edited_log.csv` is appended after every 200 response, not
at the end of a run, so an interrupted batch loses nothing.

**Always dry-run first.** `--dry` prints the exact request body. Cheap insurance against a
malformed CSV rewriting 400 works with one asset's uuid.

## The analysis that comes free

Every block reviewed adds rows to `themes_registry.csv` (media_id → theme). Joined against the
lifetime-sales export, this produces earnings per work by theme — the number that decides what
to generate next. Method and the interpretation traps in `references/portfolio-analysis.md`.

What this typically reveals, and worth checking for early: enormous quantities of near-identical
variations. One real portfolio had 161 broken-glass images earning $1.71 across two years, next
to four retro marquee signs earning $14.61 — a 330× gap per work, with no difference in
technical quality. The same pattern shows up on Adobe's side as `Similar auto rejected`
(moderation cause 8), an automatic rejection for similarity within the contributor's own batch.

That points to the rule that matters more than any keyword: **one theme, one or two works**.
Ten angles of the same ice cube compete with each other for a single query and cannibalize the
upload quota. The freed capacity should go to new themes.

When the data is thin, say so. Twenty works and one sale is an anecdote. Report absolute
counts alongside every rate so nobody builds a plan on a single download.

## Reading the rejected tab

`--rejected 1 40` harvests the rejected uploads with dates and moderation causes. It answers
questions the earnings export cannot: whether uploads actually continued, when batches landed,
and whether rejections are content-based (`Similar auto rejected`) or platform-side
(`Tech problems` — those files can simply be re-uploaded, which is the cheapest possible
portfolio growth).

Note the cause label only arrives for the selected card in the listing; the script watches the
network to recover the rest. If coverage stays at one per page, treat the distribution as a
biased sample and say so rather than extrapolating.

## Things that do not work

Documented so they are not rediscovered:

- Setting React props and clicking Save — the UI updates, no request fires, the change reverts.
- Synthetic clicks through a browser extension — silently dropped when `document.hidden` is true.
- Caching the CSRF token — it expires in under a day. It lives in an HttpOnly cookie invisible
  to JavaScript, so it must be read from the app's own outgoing requests.
- Page numbers as stable addresses — every new upload shifts them. Only media_id is stable.