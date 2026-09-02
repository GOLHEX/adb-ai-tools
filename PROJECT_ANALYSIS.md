# Project Analysis

## Scope

This analysis covers the recovered project except `05_content/`, `05_previews/`, and `.venv/`. Those directories are local-only data and are excluded from Git.

## Current Purpose

The project is a local operator toolkit for auditing and editing an Adobe Stock Contributor portfolio. It currently supports the workflow below:

1. Start Chrome with a remote debugging port and an authenticated Adobe Contributor session.
2. Harvest portfolio pages and collect `media_id`, `contentUuid`, filename, title, keywords, and category.
3. Download previews and build contact sheets for visual review.
4. Prepare metadata changes in CSV files.
5. Run a dry-run and then apply metadata through the Adobe web application session.
6. Record edited assets and maintain a separate theme registry.

The key implementation is `04_automation/adobe_edit.js`. The `skill/` directory documents the operating method, metadata rules, endpoint mechanics, and portfolio analysis approach.

## Current Architecture

The current system is a script-driven pipeline:

- **Integration:** Node.js script connected to Chrome through CDP.
- **Input:** Adobe portfolio pages, CSV metadata, local portfolio exports.
- **Processing:** React Fiber extraction, preview download, contact sheets, request preparation.
- **Output:** Adobe metadata updates, CSV files, JSON reports, local logs.
- **Human role:** Visual inspection, metadata writing, approval of live changes.
- **Persistence:** Files only. There is no application database or immutable run history.

This is useful as a proven integration prototype, but it is not yet a maintainable application.

## What Is Already Valuable

- The Adobe interaction mechanics have been investigated and implemented.
- The workflow distinguishes harvesting, review, dry-run, and live apply.
- There is protection for sold and previously edited assets.
- Metadata rules and commercial-use framing are documented.
- Theme and earnings analysis concepts are already defined.
- The implementation is small enough to migrate incrementally without replacing the working integration first.

## Main Gaps

### Application gaps

- No database or stable domain model.
- No UI for asset review, batch approval, retries, or audit history.
- No formal import pipeline for sales, rejected works, or historical portfolio exports.
- No reliable versioning of metadata rules and theme taxonomy.
- No automated metadata draft generation.
- No upload workflow for new assets.

### Reliability gaps

- Adobe private endpoints, page structure, and React Fiber fields can change without notice.
- Some batch files refer to the missing `adobe_agent.js` and are not reproducible as written.
- CSV validation is incomplete.
- UUID-to-`media_id` consistency needs an independent preflight check.
- Failure paths and process exit codes need to be made explicit.
- Reports need run IDs, input hashes, old values, new values, and immutable history.

### Security gaps

- Tokens and cookies must never appear in logs or reports.
- CDP must remain loopback-only and use a dedicated browser profile.
- Live apply needs explicit confirmation and a successful dry-run.
- A backup/export must be required before bulk changes.
- The private portfolio dump must remain local and ignored.

## Product Boundary

The first product should audit and safely edit already-published works. New uploads should be a later module because they introduce a different Adobe workflow, additional validation, and a larger operational risk.

The application should remain local-first initially. Portfolio metadata and browser authentication are sensitive, while a single operator does not need a hosted multi-user platform.

## Proposed Technical Decision

Build a **local-first modular monolith**:

- **Runtime:** Node.js 22 and TypeScript.
- **Adobe adapter:** Playwright for browser control, with CDP support for the existing integration mechanics.
- **API:** Fastify.
- **UI:** React and Vite.
- **Storage:** SQLite with Drizzle ORM.
- **Validation:** Zod for configuration, CSV imports, domain objects, and request payloads.
- **Logging:** Pino with mandatory redaction.
- **Images:** Sharp for previews and contact sheets.
- **Testing:** Vitest plus integration tests around the Adobe adapter with mocked browser/network boundaries.
- **CSV:** A real CSV parser such as Papa Parse, not ad hoc string splitting.

This keeps the existing Node integration reusable, gives the project a proper data model and operator workflow, and avoids premature cloud infrastructure.

## Core Domain Objects

- `Asset`: stable Adobe asset identity and current harvested metadata.
- `MetadataRevision`: proposed, approved, applied, or rejected metadata change.
- `Review`: human visual and semantic review decision.
- `Run`: one harvest, validation, dry-run, apply, or import operation.
- `Sale`: sale observation and earnings data for an asset.
- `Rejection`: moderation/rejection observation and reason.
- `Theme`: versioned controlled vocabulary and classification.
- `UploadCandidate`: future entity for assets prepared for upload.

## Non-Negotiable Safety Rules

1. Never apply changes without a current harvest.
2. Never apply changes when `media_id` and `contentUuid` do not match the current harvest.
3. Require a successful dry-run before live apply.
4. Require sold-asset protection data for bulk operations.
5. Store no cookies or CSRF tokens on disk.
6. Redact secrets from logs and reports.
7. Keep every applied change reversible through an immutable revision record.
8. Treat AI output as a draft that requires human approval.

## Known Uncertainties

- The Adobe endpoint and page internals must be revalidated against a live account.
- The official Adobe API capabilities and terms are not established by the recovered files.
- Historical earnings and rejected-upload data are not available in this repository.
- The binary strategy document was not independently extracted during this analysis.
- The excluded content and preview directories were intentionally not analyzed.
