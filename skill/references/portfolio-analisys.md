# Turning the audit into a content decision

The point of looking at every image is not only to fix its metadata. It is to build the one
table nobody has: what the portfolio contains, and what each theme actually earned.

## Building the theme table

After each block, append `media_id, theme, title, source` to `themes_registry.csv`. Themes are
assigned by regex over the title and keywords just written, so no extra manual pass is needed.

Join against the lifetime-sales export (media_id, downloads, earnings, first_sale, last_sale)
and aggregate:

| column | meaning |
|---|---|
| works | how much of the portfolio the theme occupies |
| downloads | volume |
| earnings | total over the observation window |
| **$/work** | the decision number |

`$/work` is what matters. Total earnings reward whatever theme happens to be largest; per-work
earnings say whether making another one is worth the quota.

## Reading it honestly

Rates over tiny denominators are the main way this analysis goes wrong.

- Always print counts next to rates. "$3.65 per work" over four works is a hint; over four
  hundred it is a finding.
- A theme with zero sales and six works has not been disproven. A theme with zero sales and
  a hundred and sixty has.
- Sold assets are excluded from editing, so they must be classified separately — otherwise the
  earning themes vanish from the table that is supposed to find them.
- Regex classification will misfile some works. Check the "other" bucket; if it exceeds ~15%
  the theme list needs another pass.

## The pattern to look for first

Count of works per theme against earnings per work. Concentration in a zero-earning theme is the
most actionable thing the audit can find, and it is invisible without this table.

One measured portfolio, 795 works audited over two years:

| theme | works | earnings | $/work |
|---|---:|---:|---:|
| retro marquee signs | 4 | $14.61 | 3.653 |
| piggy banks | 44 | $20.91 | 0.475 |
| cybersecurity and threats | 44 | $14.93 | 0.339 |
| **broken glass** | **161** | **$1.71** | **0.011** |
| ice | 71 | $0 | 0 |

Twenty-nine percent of the audited portfolio sat in two themes that earned $1.71 across two
years. Per work, the gap between the best and worst theme was 330×, with no difference in
technical quality — the glass renders were flawless. Three themes out of twenty-nine produced
90% of the revenue from 12% of the works.

## Three signals that separate earners from filler

Derived from the same data set. They are hypotheses with support, not laws — check them against
the portfolio at hand.

**Room for the buyer's own content.** Every marquee sign that sold has a blank board for the
buyer's text. So does the single highest-earning asset in that portfolio — a watercolour
background carrying 20% of two years' revenue on its own. The buyer is not paying for a picture,
they are paying for a stage.

**A scenario with a budget behind it.** Seven of forty-four piggy banks sold, and five of those
seven were the graduation-cap and suitcase variants. Not "piggy bank" but "saving for tuition"
and "saving for a holiday" — themes banks run campaigns for. Generic money bags with no scenario
earned $0.86 across eleven works.

**Alarm and news cycle.** Laptops with warning triangles, magnifiers over threat icons, virus
cells: eighteen downloads across forty-four works. Publications need these every week and the
demand is not seasonal.

The inverse also held: not one aesthetic still life, pastel flat lay or abstract texture appeared
among the sellers, despite there being plenty of them.

## The rule that follows

**One theme, one or two works.** Ten angles of the same ice cube do not produce ten times the
sales — they produce roughly what one produces, while consuming ten times the upload quota and
splitting the ranking signal for a single query.

Adobe enforces the same thing from its side: moderation cause 8, `Similar auto rejected`,
an automatic rejection for similarity within the contributor's own batch, sent from
`stocksite-moderation-devs@adobe.com` with no human review. In the measured account this
produced 4,000+ rejections across five upload batches — and inspection showed the rejected files
had correct, niche-oriented titles with twenty keywords each. The metadata was fine. The images
were too similar to each other.

## Diagnosing a decline

Falling revenue has several possible causes and they lead to opposite plans, so identify the
cause before proposing anything.

| observation | where to look |
|---|---|
| did uploads actually stop? | rejected-tab dates — they timestamp every batch, including recent ones |
| is it one asset ending its run? | per-asset monthly curve; recompute the year-over-year change with that asset removed |
| is it similarity rejection? | moderation cause distribution |
| is it maturation lag? | days from upload to first sale, by cohort |

Two traps worth naming:

**Concentration masquerading as collapse.** One asset carried 20% of two years' revenue and its
curve fell off a cliff after five months. The portfolio still declined 64% year over year with
that asset excluded — so the collapse was real, but attributing all of it to that asset would
have been wrong. Always recompute with the top earner removed.

**Maturation lag measured on too short a window.** Twelve months of data suggested a median of
438 days to first sale and that nothing under three months ever sells. Two years of data gave a
median of **111 days**, with 155 works selling inside 30 days. The first figure was an artifact
of the window: assets that sell quickly were still selling when the window closed, so their
first sales fell outside it. This matters — 111 days means autumn generation reaches the January
peak, and 438 days means it does not.

## Seasonality

Measured pattern, worth re-deriving per account:

- **September–October** — highest volume; 27% of annual downloads in two months, as businesses
  return and plan Q4.
- **January** — highest price per download ($1.04 against $0.81 average); annual campaigns and
  extended licences.
- **July–August** — trough, roughly a quarter of peak volume. A weak August is partly the season,
  not only weak metadata.

Combined with a 111-day maturation lag: content for the January peak is generated in
September–October; content for the following September is generated in May.