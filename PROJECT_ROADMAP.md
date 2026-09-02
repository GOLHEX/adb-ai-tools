# Project Roadmap

## Product Goal

Create a local-first application that audits an Adobe Stock Contributor portfolio, proposes and reviews metadata improvements, safely applies approved changes, and later prepares new uploads. Every live operation must be observable, reversible, and protected against asset mismatch.

## Phase 0: Stabilize the Recovered Prototype

**Outcome:** the current workflow is reproducible.

- Make one canonical copy of `adobe_edit.js` and remove duplicate script drift.
- Replace or remove batch files that reference missing `adobe_agent.js`.
- Define configuration through environment variables or a local config file.
- Add explicit non-zero exit codes on failures.
- Add CSV schema validation and useful error messages.
- Add smoke tests for harvest parsing, dry-run payloads, sold protection, and edited protection.
- Document the live Adobe session prerequisites.

**Done when:** a clean machine can run harvest, dry-run, and a mocked apply using documented commands.

## Phase 1: Safe Domain Model and Storage

**Outcome:** file-based state becomes queryable and auditable.

- Create a TypeScript workspace and preserve the working Adobe adapter behind an interface.
- Add SQLite and Drizzle migrations.
- Implement `Asset`, `MetadataRevision`, `Review`, `Run`, `Sale`, `Rejection`, and `Theme` tables.
- Import portfolio CSV, sales data, rejected uploads, and theme registry.
- Enforce unique `media_id` and current `contentUuid` checks.
- Store input file hashes, timestamps, source, rule version, and run IDs.
- Keep applied revisions immutable and retain old values.

**Done when:** importing the same source twice is idempotent and every metadata change can be traced to a run and approval.

## Phase 2: Validator and Approval Workflow

**Outcome:** no unsafe batch can reach Adobe.

- Validate title, keywords, category, duplicate keywords, keyword order, and field limits.
- Detect duplicate or suspiciously similar assets where data permits.
- Compare proposed metadata with the latest harvest.
- Require current sold-asset protection data.
- Generate a dry-run diff with exact request bodies but no secrets.
- Add explicit approve, reject, cancel, and retry states.
- Require a successful preflight before live apply.
- Add backup/export before bulk apply.

**Done when:** a live apply is impossible without current data, valid metadata, approved revisions, and a successful dry-run.

## Phase 3: Operator Interface

**Outcome:** the workflow is usable without editing CSV files manually.

- Add Fastify API endpoints for assets, revisions, runs, imports, and approvals.
- Add React/Vite screens for asset list, filters, preview, metadata comparison, and batch review.
- Show sold, edited, unreviewed, failed, and approved states clearly.
- Add retry for failed assets without repeating successful ones.
- Show progress and a secret-free operation log.
- Keep UI and API local by default.

**Done when:** an operator can import a harvest, review a batch, approve it, run dry-run, apply it, and inspect the result from the UI.

## Phase 4: Portfolio Analytics

**Outcome:** recommendations are based on evidence rather than intuition.

- Build controlled theme taxonomy and version it.
- Calculate earnings per work with sample size visible.
- Add cohort analysis by upload date, first-sale lag, seasonality, and rejection causes.
- Measure duplicate/similarity patterns and keyword overlap.
- Separate content performance from metadata performance.
- Generate recommendations with absolute counts, date windows, and uncertainty notes.
- Export reproducible reports.

**Done when:** every recommendation can be traced to source data, filters, and a reproducible query.

## Phase 5: Assisted Metadata Generation

**Outcome:** AI accelerates drafting without gaining uncontrolled write access.

- Add an image/preview analysis provider behind an interface.
- Generate draft title, keywords, category, confidence, and rationale.
- Validate claims against visible image evidence and metadata rules.
- Support human edits and approval history.
- Measure acceptance rate, correction rate, and rejected suggestions.
- Keep generation, approval, dry-run, and apply as separate states.

**Done when:** AI can produce useful drafts for a review queue, but cannot publish or apply them without explicit approval.

## Phase 6: New Upload Preparation

**Outcome:** new content can be prepared safely.

- Add naming validator and upload manifest generation.
- Add theme/subtheme quotas and duplicate checks.
- Add similarity preflight against the local portfolio.
- Track candidate, prepared, uploaded, submitted, accepted, and rejected states.
- Integrate the Adobe upload flow only after the published-work workflow is stable.

**Done when:** the system can prepare a verifiable upload batch and recover cleanly from partial failures.

## Stack Decision

Start with TypeScript and Node.js 22, Playwright/CDP, Fastify, React/Vite, SQLite/Drizzle, Zod, Pino, Sharp, CSV parsing, and Vitest. Use a modular monolith first. Move to PostgreSQL, background workers, or a hosted deployment only when multiple operators or larger workloads justify that complexity.

## First Implementation Slice

The first coding slice should be Phase 0 plus the minimum of Phase 1:

1. Create the TypeScript project shell and test setup.
2. Wrap the current Adobe script in an adapter interface.
3. Add strict schemas for harvested assets and apply CSV input.
4. Add a SQLite database with `Asset`, `Run`, and `MetadataRevision`.
5. Implement an import command and a dry-run command.
6. Add tests that prove sold protection, UUID consistency, and secret redaction.

This slice gives the project a reliable foundation before any UI or AI work begins.

## Exclusions

`05_content/`, `05_previews/`, and local portfolio exports remain outside Git. They are inputs to local runs, not source code or public project assets.

## Language Policy

The Russian and English roadmap versions are maintained in sync. New architectural decisions, phase changes, and completion criteria must be updated in both `PROJECT_ROADMAP.md` and `PROJECT_ROADMAP_RU.md`.
