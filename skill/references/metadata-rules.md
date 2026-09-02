# Titles and keywords for stock assets

## The title formula

```
[subject + defining detail] + [composition / format] + [2–3 application niches]
```

The third block is the one that gets omitted, and it is the one that makes the asset findable.
A buyer does not search for what is depicted — they search for what they need to illustrate.
A title with no use case is a caption, not a listing.

**Composition vocabulary that buyers actually search:** banner, copy space, wide, vertical,
square, close up, flat lay, mockup, top view, isolated.

**Niches must be specific enough to imply a budget.** "for creative projects" means nothing.
"for cafe menus", "for student loan ads", "for ESG reports", "for winery label mockups" name
someone with a campaign.

### Rebuilds

| before | after |
|---|---|
| `Pink background frame with fresh oranges glasses and pencils copy` | `Citrus frame on pink banner with copy space for summer promos` |
| `A symbolic representation of financial growth, featuring saplings emerging from stacked coins` | `Saplings rising from stacked coins with copy space, ideal for pension fund ads, wealth management and eco finance pages` |
| `Abstract image of shattered glass with a sparkling core` | `Circular hole in shattered glass with radiating shards, perfect for crime covers, security ads and thriller art` |

### The first word

The word people search by leads. A descriptive adjective is fine when the adjective **is** the
subject — `Vibrant watercolor background`, `Abstract gradient wave`. In one portfolio the single
highest-earning asset across two years opens exactly that way.

What does not belong is an adjective that adds nothing to a concrete noun: `Beautiful pink tube`,
`Creative office desk`, `Nice coffee cup`. In keywords, empty adjectives are always out.

### Length

| channel | limit |
|---|---|
| CSV import | 70 characters, no commas — a hard format requirement |
| Web UI / details endpoint | far longer; 100–150 characters with commas is normal, and is the form top-earning assets take |

Editing published assets goes through the second channel. Do not carry the CSV limit over —
it costs the application-niche block, which is the most valuable part of the title.

### Self-check

If the title does not make clear **what someone would buy this for**, rewrite it.

## Keywords: 8–34, chosen by the frame

A fixed quota damages both ends. A simple frame padded to twenty gains filler that dilutes the
first ten positions, which are the ones Adobe weights. A rich scene capped at twenty leaves real
queries uncovered.

| frame | count | example |
|---|---|---|
| single object or plain texture on flat ground | 8–12 | gradient banner, seamless pattern, blank tag, glass shard on black |
| object with context or 2–3 use cases | 14–20 | piggy bank with suitcase, laptop with warning sign, coin jar with sprout |
| scene with people, action and setting | 22–34 | nurse with a patient in a ward, hacker at two screens, family table spread |

Every keyword should answer one of these. If it answers none, drop it:

- **what is shown** — subject, material, colour, count
- **how it is shot** — composition, format, angle, space for text
- **where and when** — setting, season, time of day
- **what it will be bought for** — industry, campaign, medium

The last category should be at least a third of the list. A list that only answers the first
question will never surface on a commercial query.

Other rules:

- One keyword is usually one word. Two words only for established search terms:
  `copy space`, `flat lay`, `black and white`, `back to school`, `color palette`.
- Order by descending search frequency. The first ten carry the weight.
- Never repeat the whole title as a phrase keyword.
- Junk out: `abstract`, `colorful`, `beautiful`, `creative`, `nice`, `image` — unless one of
  them literally describes the subject. `background` only when the frame really is a backdrop
  with room for text.
- CSV format caps at 50.

### The anti-pattern

Nineteen keywords on one published asset, every one a three-word phrase:
`pastel candles row`, `lit birthday candles`, `purple pink blue candles`, `celebration candle set`.
Nobody types those. The high-frequency singles — `candle`, `pastel`, `birthday`, `banner` — are
buried inside phrases where the search index cannot reach them as leading terms.

### Editorial keywords are underrated

For anything destined for an article rather than a product page, add the medium:
`editorial`, `blog`, `news`, `report`, `poster`, `presentation`. Illustrations of fraud,
outbreaks, fuel prices and layoffs are bought by publications on a weekly cycle, and those words
are how publications search.

## CSV requirements (for import, not for the edit endpoint)

| field | requirement |
|---|---|
| Filename | exact, with extension, ≤ 30 characters |
| Title | ≤ 70 characters, no commas or special characters |
| Keywords | comma-separated, most important first, ≤ 50 |
| Category | numeric id, not a label |
| file | UTF-8, .csv only, ≤ 5000 rows and 1 MB |

## Filenames carry the analysis

The sales export includes a filename column, so a name that encodes the theme turns "what should
I generate" from a debate into a group-by:

```
YYYYMMDD_theme_subtheme_ratio_NNN.png     20260826_finance_tuition_16x9_004.png
```

The subtheme is the diversity counter. Grouping by `theme_subtheme` before upload and capping
each pair at two files is one line of code and removes the main cause of similarity rejections.

Names like `20250404_10559.jpeg` carry only a date, which is why an existing portfolio can only
be analyzed by looking at every image.