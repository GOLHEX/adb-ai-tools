# How editing published Adobe Stock assets actually works

Verified against a live contributor account. Adobe publishes no API for this; everything below
was recovered by observing the contributor portal.

## The save request

```
POST https://contributor.stock.adobe.com/en/content/{media_id}/details

headers:
  Content-Type: application/json
  Accept: application/json
  X-Requested-With: XMLHTTPRequest
  csrf-token: <fresh>

body:
  {"title": "...", "contentUuid": "...", "category": 10162, "keywords": ["money","coins", ...]}
```

HTTP 200 means the change is already in the database — reloading the portfolio page shows it.

Keywords are accepted as an array in the same body. There is no separate keyword endpoint;
this was the main unknown and it is settled.

## contentUuid is per-asset

Not the media_id, not a session value. Every work has its own uuid and sending the wrong one
writes to a different asset. This is the single most dangerous failure mode in the whole
workflow — an early version of the tool cached the uuid from a captured request and would have
written one asset's uuid to every work in the batch.

The uuid is not exposed by any documented endpoint. It lives in the React fiber of the portfolio
listing:

```js
document.querySelectorAll('[data-t="portfolio-single-asset-wrapper"]')
// element carries a __reactFiber$… key → walk .return upward to memoizedProps.asset
// asset = { id, uuid, title, category, keywords, originalName,
//           largePreviewUrl, thumbnailUrl, … }
```

`--harvest` walks the pages and writes all of this to `portfolio_dump.csv`; `--apply` looks up
the uuid there by media_id.

`asset.originalName` holds the uploaded filename — the join key to the sales export, which also
carries filenames. Field names matter: it is `originalName`, not `fileName`.

## The CSRF token cannot be stored

It expires in well under a day, and its source is the HttpOnly cookie `_scsrf`, which JavaScript
cannot read by design. Searching page HTML, `document.cookie` and `window` objects returns
nothing — this is expected, not a bug.

What works: enable the Network domain over CDP, reload the page, and read the token from the
app's **own** outgoing requests. The portal attaches `csrf-token` to all of its XHRs, including
harmless ones like `/en/log/event` and `/en/user/statistics/overview`. The script grabs the
first one and exits early, so it costs a couple of seconds.

If the server still answers `INVALID_CSRF_TOKEN`, the script re-reads the token and retries once
before failing.

## Rate

3 seconds between works, adjustable with `--delay`. Nothing on the server side demands this; it
is deliberate restraint. The bottleneck is writing metadata, not sending requests, so there is
nothing to gain by pushing harder.

`apply_report.json` is rewritten after every work, so an interrupted run leaves a complete
record of what got through.

## Previews

`asset.largePreviewUrl` is a 500px JPEG on `as2.ftcdn.net` — enough resolution to judge subject,
composition and mood.

Download them from Node, not from the page: `as2.ftcdn.net` is a different origin and CORS
prevents the page from reading the response body. This fails silently — the fetch succeeds, the
body is unreadable, and the count comes back zero with no error. If a datacenter IP gets 403
from the CDN, the script falls back to pulling bodies out of the browser's own network layer via
`Network.getResponseBody`, where CORS does not apply.

## Contact sheets

`--sheets` renders previews into a grid inside the browser and screenshots it via
`Page.captureScreenshot`. This turns 500 files into 25, which matters when the images have to
cross a machine boundary to be looked at.

By default only unreviewed works are included — sold and already-edited ones are filtered out,
old sheets are deleted, and `sheets/index.csv` records which media_ids landed on which sheet.
Without that index, sheet numbers drift between runs and references to "sheet 12" become
meaningless.

## Page numbers are not addresses

Sorting is `create_desc`, so every new upload pushes everything down. Between two harvests a
week apart, pages 18–19 returned exactly what pages 16–17 had returned before.

Consequences: `portfolio_dump.csv` merges by media_id instead of overwriting, and any note about
"page N" needs a date attached to mean anything.

## Command reference

| command | purpose |
|---|---|
| `--harvest FROM TO` | harvest pages, merge into `portfolio_dump.csv`, download previews |
| `--sheets [--per N] [--all]` | build contact sheets from unreviewed previews, write `index.csv` |
| `--apply FILE.csv [--dry] [--limit N]` | apply metadata; input columns `media_id,title,keywords,category` |
| `--rejected FROM TO` | harvest rejected uploads with dates and moderation causes |
| `--fields` | dump every field of one asset object — for finding new fields |
| `--sniff [--listen N]` | show all traffic carrying a token, plus HttpOnly cookies |
| `--token` | show CSRF token candidates found in the page |
| `--rejprobe` | inspect the rejected page: counters and where causes are rendered |

Flags: `--delay MS`, `--browser URL`, `--soldlist PATH`, `--editedlog PATH`, `--previews DIR`,
`--no-skip-sold`, `--redo`, `--no-previews`, `--via-browser`, `--all`.