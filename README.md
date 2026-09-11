<div align="center">

# Postbench

**A local-first social posting cockpit for one person.**

Turn one product update and a few screenshots into platform-specific drafts for LinkedIn, Instagram, Facebook and X. Review them locally, then let Postbench fill the real composers.

**You click Publish. Postbench never does.**

</div>

---

## Workflow

```text
idea + media
    ↓
AI drafts
    ↓
review + edit + choose media per platform
    ↓
validation
    ↓
Postbench fills and verifies each composer
    ↓
you review the real composer and click Publish
```

Postbench intentionally does **not** include scheduling, analytics, inboxes, teams, OAuth or automatic publishing.

## Requirements

- Node 20+
- Chromium installed through Playwright for composer preparation
- Optional: FFmpeg for MOV → MP4 conversion
- Optional: Anthropic/OpenAI/Ollama/Claude CLI for AI generation

## Install

```bash
git clone https://github.com/Bbrizly/PostBench.git postbench
cd postbench
npm install
npx playwright install chromium
npm run check
npm link # optional
```

Without `npm link`, use `node bin/postbench.js <command>`.

## Quick start

```bash
postbench doctor
postbench create --input "We shipped offline search."
```

Then:

1. Add or edit the source idea and optional URL.
2. Drop in images/videos or paste a screenshot.
3. Describe media if the AI needs context that is not obvious from the source text.
4. Generate drafts.
5. Edit copy, hashtags and per-platform media selection.
6. Fix any validation errors.
7. Click **Prepare**.
8. Postbench opens the real composers and verifies the reviewed payload where the platform exposes enough DOM state.
9. Review the real composer yourself and click the platform's Publish/Post/Share button.
10. Optionally mark the post as posted and store its URL in Postbench.

Draft edits autosave. Actions that depend on saved state flush pending edits first, and stale writes are rejected instead of overwriting newer work.

## CLI

```text
postbench create [--input "..."] [--url "..."] [--no-open]
postbench open <draft-id>
postbench serve [--no-open]
postbench list
postbench generate <draft-id>
postbench doctor
```

## AI providers

Postbench chooses a provider automatically unless `POSTBENCH_AI_PROVIDER` is set.

| Provider | Selected when | Requirement |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` exists | API key |
| `openai` | `OPENAI_API_KEY` exists | API key |
| `claude-cli` | default fallback | logged-in `claude` CLI |
| `ollama` | explicitly selected | local Ollama server |
| `none` | explicitly selected | deterministic offline templates |

Useful environment variables:

```text
POSTBENCH_AI_PROVIDER
POSTBENCH_AI_MODEL
POSTBENCH_AI_TIMEOUT_MS
POSTBENCH_CLAUDE_BIN
OLLAMA_HOST
POSTBENCH_HOME
PORT
```

API providers use bounded timeouts and retries for transient failures. Model output must contain every requested platform, pass parsing, and fit deterministic character limits. If the first model response is malformed or violates those constraints, Postbench makes one correction attempt rather than looping indefinitely.

The prompt treats source content and media descriptions as data, not instructions, and tells the model not to invent metrics, customers, quotes, features, integrations, dates or technical details.

### Offline fallback

`POSTBENCH_AI_PROVIDER=none` uses deterministic templates. They are deliberately plain; they exist so the workflow still functions without an AI provider. Safe transforms such as **Shorter** work offline, while transforms that would require inventing new technical detail do not.

## Brand voice

The repository ships with a neutral default in `config/brand.json`:

```json
{
  "name": "My Project",
  "website": null,
  "audience": [],
  "voice": ["plainspoken", "direct", "practical"],
  "avoid": ["AI hype", "corporate SaaS language", "revolutionary", "game-changing"],
  "preferred_phrases": []
}
```

Create `~/.postbench/brand.json` to override it. The user-level file wins over the repository default.

## Media

Postbench accepts PNG, JPEG, WEBP, GIF, MP4 and MOV into the local media workspace. Uploads are staged on disk rather than buffered in process memory, and supported formats are checked from file signatures instead of trusting the browser-provided MIME header.

MOV files can be normalized to H.264/AAC MP4 with FFmpeg. The conversion is a real transcode and therefore may be lossy.

Platform validation currently includes text limits, supported MIME types, required media, media counts and mixed-media rules. Examples include up to 20 desktop images for LinkedIn and up to four total media items for X. These platform rules can change, so they live centrally in `src/shared/types.ts` and should be kept current.

When a generated post has no explicit media selection, Postbench chooses only a compatible starting set instead of blindly attaching every image.

## Browser preparation

Postbench uses one persistent Chromium profile:

```text
~/.postbench/browser-profile
```

Log into the supported platforms manually inside that browser. Postbench does not request passwords, extract cookies, bypass CAPTCHA/2FA or click the final publish action.

One managed tab is reused per platform. Preparation follows observable composer state rather than fixed upload sleeps. A platform is marked `ready` only when Postbench can verify the expected reviewed text, required media state and final action state closely enough for that adapter. Otherwise it reports `partial` or `failed` and leaves the page open for manual completion.

### Real-world adapter status

The automated test suite does **not** log into social accounts and does not create public posts. Platform DOMs change, so logged-in smoke testing with controlled accounts is still required before treating selectors as production-stable.

Instagram remains the most complex adapter because its create flow can include media selection, crop/edit steps and caption composition.

## Draft integrity

Drafts are stored under:

```text
~/.postbench/
├── drafts/<id>.json
├── media/<draft-id>/
├── browser-profile/
└── brand.json
```

Writes are atomic and serialized per draft. Drafts carry a revision number so stale full-draft writes return a conflict instead of silently replacing newer changes.

Preparation and publication records include a key for the exact text/hashtags/media payload they refer to. Editing that payload makes the old record stale instead of falsely claiming the new version was already prepared or posted.

Media file paths and file metadata are server-owned; the browser client cannot inject arbitrary filesystem paths through a draft save.

## Architecture

```text
src/
├── ai/          prompt, providers, strict result parsing, one repair pass, offline fallback
├── cli/         command-line interface
├── platforms/   Playwright composer adapters; no publish() method
├── server/      local Express API, persistence and media handling
├── shared/      schemas, composition, platform rules and status derivation
└── ui/          React/Vite review workspace
```

The AI writes copy. Deterministic code owns persistence, validation, file handling and browser handoff.

## Doctor

```bash
postbench doctor
```

Doctor checks the data directory, configured AI provider, actual Playwright Chromium executable, browser profile, FFmpeg, brand and UI build.

## Development

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run check
```

`npm run check` runs typechecking, tests and the production build. CI runs the same gate on Node 20 and Node 22.

Tests cover schemas and helpers, platform validation, generation parsing/repair, revision conflicts, API behavior, media-content validation, exact prepare bookkeeping and the adapter runner contract. Browser/platform calls are mocked in automated tests so the suite cannot accidentally publish anything.

## Security and privacy

- The server binds to `127.0.0.1`.
- Drafts and media stay local unless you explicitly send source text/descriptions to a configured AI provider or upload media to a social composer.
- Browser authentication stays in the dedicated local Chromium profile.
- Postbench does not request or type social passwords.
- Postbench does not bypass CAPTCHA, 2FA or platform verification.
- Postbench has no automatic publish method.
- Media deletion is restricted to the Postbench media directory.
- `.env` files are ignored by Git to reduce accidental secret commits.

Use `POSTBENCH_AI_PROVIDER=ollama` or `none` if source text should not be sent to an external AI API.

## Known limitations

- Social platform selectors can break when platform UIs change.
- Logged-in composer flows still require controlled real-account smoke testing.
- Instagram's composer is inherently more fragile than the others.
- No threads, scheduling, analytics, platform-side draft synchronization or social inbox.
- No media editor; Postbench only performs MOV → MP4 normalization.
- Desktop-first UI.

The boundary is intentional: **Postbench prepares; you publish.**
