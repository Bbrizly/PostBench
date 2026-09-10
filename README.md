<div align="center">

# Postbench

**A local-first social posting cockpit for one person.**

Give it an idea and some screenshots. It writes four platform-specific drafts.
You edit them in one local browser UI, click one button, and Postbench opens the real
composers on LinkedIn, Instagram, Facebook and X with your text and media already filled in.

### You click Publish. Postbench never does.

*Write once. Adjust it. Get it out.*

<br>

[![Node](https://img.shields.io/badge/node-%E2%89%A520-3c873a?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Playwright](https://img.shields.io/badge/Playwright-automation-2ead33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev)
[![Tests](https://img.shields.io/badge/tests-49%20passing-1a7f4b?style=flat-square)](#tests)
[![Local only](https://img.shields.io/badge/data-100%25%20local-6b6b64?style=flat-square)](#where-your-data-lives)

</div>

<!-- screenshot placeholder: docs/postbench-main.png -->
<!-- gif placeholder: docs/postbench-prepare.gif -->

---

```
        idea + screenshots
                │
                ▼
        ┌───────────────┐
        │  AI drafts    │   four platform-specific posts
        └───────┬───────┘
                ▼
        ┌───────────────┐
        │  you review   │   edit · hashtags · pick media per platform
        └───────┬───────┘
                ▼
        ┌───────────────┐
        │  prepare      │   real composers, filled in
        └───────┬───────┘
                ▼
          you click Publish
```

## Contents

- [Why](#why) · [What it is not](#what-it-is-not)
- [Install](#install) · [Quick start](#quick-start) · [CLI](#cli)
- [AI setup](#ai-setup) · [Brand voice](#brand-voice)
- [Browser setup](#browser-setup) · [Platform adapters](#platform-adapters--honest-status)
- [Media support](#media-support) · [Claude Code skill](#claude-code-skill)
- [Where your data lives](#where-your-data-lives) · [Architecture](#architecture)
- [Doctor](#doctor) · [Troubleshooting](#troubleshooting)
- [Security](#security) · [MVP limitations](#mvp-limitations) · [Tests](#tests)

---

## Why

You shipped something. Now you need four different posts about it, each one written the way
that platform actually reads, each with the right screenshots attached. That is twenty minutes
of copy-paste and tab-juggling for something that took you an hour to build.

Postbench collapses that into: paste the idea, drop the screenshots, edit four cards, press one
button.

## What it is not

Not Buffer, not Hootsuite, not a CRM. No scheduler, no calendar, no analytics, no inbox,
no team features, no OAuth, no cloud, no accounts. Everything lives on your machine.

---

## Install

Requires **Node 20+** (developed and tested on Node 22).

```bash
git clone https://github.com/adisagar2003/PostBench.git postbench && cd postbench
npm install
npx playwright install chromium     # the browser used to fill composers
npm run build                       # builds the API and the UI
npm link                            # optional: puts `postbench` on your PATH
```

Without `npm link`, run everything as `node bin/postbench.js <command>`.

## Quick start

```bash
postbench doctor                                     # check the setup
postbench create --input "We shipped offline search."
```

The UI opens at `http://127.0.0.1:<port>`. Then:

| Step | What you do |
| :-- | :-- |
| **1** | Type or paste your idea |
| **2** | Drag in images/videos, or paste a screenshot with <kbd>⌘V</kbd> / <kbd>Ctrl+V</kbd> |
| **3** | Describe each media file so the AI knows what the screenshot shows |
| **4** | **Generate** → four drafts appear |
| **5** | Edit text · click hashtag chips · tick which media goes to which platform |
| **6** | **Prepare Selected Posts** → composers open, filled in |
| **7** | Review each one and **click Publish yourself** |
| **8** | **Mark as posted** back in Postbench (optionally paste the post URL) |

Everything autosaves as you type.

### Per-platform rewrites

Each card has **Shorter · More casual · More technical · Less promotional**. These rewrite
**only that card** — regenerating LinkedIn never touches Instagram, Facebook or X.

### Per-platform media

The media workspace is shared; the selection is not. LinkedIn can take two screenshots while
Instagram takes the video and X takes one image. Tick boxes, per card.

## CLI

```
postbench create [--input "..."] [--url "..."]   new draft, opens the UI
postbench open <draft-id>                        reopen a draft
postbench serve [--no-open]                      just start the UI
postbench list                                   list drafts
postbench generate <draft-id>                    generate in the terminal, no UI
postbench doctor                                 check runtime, AI, Playwright, FFmpeg, dirs
```

---

## AI setup

Postbench picks a provider automatically. Override with `POSTBENCH_AI_PROVIDER`.

| Provider | Chosen when | Needs |
| :-- | :-- | :-- |
| `anthropic` | `ANTHROPIC_API_KEY` is set | API key |
| `openai` | `OPENAI_API_KEY` is set | API key |
| `claude-cli` | **default fallback** | the `claude` CLI, already logged in |
| `ollama` | `POSTBENCH_AI_PROVIDER=ollama` | Ollama running locally |
| `none` | `POSTBENCH_AI_PROVIDER=none` | nothing — offline template drafts |

Other env vars: `POSTBENCH_AI_MODEL`, `POSTBENCH_AI_TIMEOUT_MS`, `OLLAMA_HOST`,
`POSTBENCH_HOME`, `PORT`.

Adding a provider is one function in `src/ai/adapters.ts` — everything else talks to the
`Adapter` interface (`complete(prompt) => string`). Nothing in the app is wired to a vendor.

If no provider works, Postbench falls back to plain offline template drafts and tells you so.
They are a starting point, not good copy.

### Media-aware generation

Every media card has a **description** field. Whatever you write there is passed to the model
alongside the idea, so the copy talks about what the screenshot actually shows:

> *"Screenshot showing Faultbench finding a compressor diagnostic procedure."*

Postbench does not send image bytes anywhere. Descriptions are typed by you.

### Brand voice

`config/brand.json` is the default; `~/.postbench/brand.json` overrides it if present.

```json
{
  "name": "Faultbench",
  "website": "https://faultbench.com",
  "audience": ["HVAC technicians", "tradespeople"],
  "voice": ["plainspoken", "practical", "direct"],
  "avoid": ["AI hype", "revolutionary", "game-changing"],
  "preferred_phrases": ["Don't trust the AI. Check the manual."]
}
```

`avoid` is enforced in the prompt — that is what keeps "I'm thrilled to announce" out of your
LinkedIn posts.

---

## Browser setup

Postbench drives one dedicated Chromium profile:

```
~/.postbench/browser-profile
```

The first time you prepare a post, that browser opens and you will be logged out.
**Log into LinkedIn, Instagram, Facebook and X by hand in that window, exactly as you normally
would.** The session persists — you do this once.

> Postbench never asks for, stores, or types your passwords. It does not extract cookies and
> does not work around CAPTCHAs, 2FA, or bot protection. If a platform wants verification, it
> stops and tells you to finish it yourself.

Close that browser window before starting a second Postbench instance — one profile, one process.

## Platform adapters — honest status

Each adapter implements `openComposer` / `setText` / `uploadMedia` / `checkReady`.
There is deliberately **no `publish()` anywhere in the codebase**, and a test asserts that.

| Platform | Logged-out handling | Composer fill |
| :-- | :-- | :-- |
| LinkedIn | ✅ tested — reports "log in" | ⚠️ **untested against a real account** |
| X | ✅ tested — reports "log in" | ⚠️ **untested against a real account** |
| Facebook | ✅ tested — reports "log in" | ⚠️ **untested against a real account** |
| Instagram | ✅ tested — reports "log in" | ⚠️ **untested**, and the most fragile — its create flow has a crop step and a filter step |

To be clear: the adapters were verified end-to-end up to each platform's login wall. Testing the
filled-in composer would mean logging into real accounts and risking a real public post, so that
line was not crossed. Selectors are built from stable roles, labels and `data-testid`s rather
than generated CSS, but watch the first run on each platform.

When an adapter cannot find the composer it says so **once**, leaves the page open, and stops.
It never retries in a loop or clicks around hunting for buttons. Every card also has
**Open &lt;platform&gt;** and **Copy** so you can always finish by hand.

## Media support

| Type | Accepted | Notes |
| :-- | :-- | :-- |
| PNG, JPG/JPEG, WEBP, GIF | ✅ | WEBP is rejected by Instagram |
| MP4 | ✅ | |
| MOV | ⚠️ | Instagram and X reject it — click **→ MP4** on the card to convert with FFmpeg |

Per-platform rules are enforced before preparing: character counts (including X's 23-character
URL rule), max images, max videos, no mixing images and video except on Instagram, and
Instagram's media requirement. They live in `PLATFORM_LIMITS` in `src/shared/types.ts` and are
one edit away when a platform changes.

Errors are readable, never stack traces:

> *"Instagram cannot use this media combination — images and video must be posted separately."*

There is no media editor. No trimming, filters, effects, subtitles, or background removal.
FFmpeg is optional; without it MOV conversion is unavailable and Postbench says so.

---

## Claude Code skill

```bash
mkdir -p ~/.claude/skills
cp -r skills/postbench ~/.claude/skills/
```

Then, in Claude Code:

> *"Make a post about today's Faultbench changes."*

Claude reads the diff, works out what actually changed **for users** (not the implementation),
runs `postbench create --input "..."`, and hands the UI to you. The skill explicitly forbids
Claude from publishing and from inventing product claims.

## Where your data lives

```
~/.postbench/
├── drafts/<id>.json      draft artifacts — source, media refs, per-platform posts, status
├── media/<draft-id>/     copies of the files you dropped in
├── browser-profile/      the persistent Chromium profile (your logged-in sessions)
└── brand.json            optional brand override
```

Change the root with `POSTBENCH_HOME`. See [`examples/example-draft.json`](examples/example-draft.json)
for the draft format.

## Architecture

```
src/
├── cli/         the postbench command
├── server/      express API on 127.0.0.1, filesystem persistence, media handling
├── ui/          React + Vite — the whole review surface
├── ai/          ContentGenerator: prompt → adapter → tolerant JSON parsing → offline fallback
├── platforms/   one Playwright adapter per platform + a runner that never publishes
└── shared/      draft schema (zod), validation, hashtag and character-count logic
skills/postbench/SKILL.md
examples/example-draft.json
config/brand.json
```

**AI does the writing and rewriting. Deterministic code does everything else** — saving,
counting, validating, navigating, uploading, selecting media. Generation and publishing are
separate steps by design: there is no path from "generate" to "posted" without you.

## Doctor

```bash
postbench doctor
```

```
Node             v22.16.0
Data directory   ~/.postbench
Drafts           ~/.postbench/drafts · 3 draft(s)
AI provider      Claude Code CLI (claude -p)
Playwright       ok (…/chromium-1243/…)
Browser profile  ~/.postbench/browser-profile
FFmpeg           ok
Brand            Faultbench
UI build         ok
```

## Troubleshooting

| Symptom | Fix |
| :-- | :-- |
| *"The UI has not been built yet"* | `npm run build`. For UI development use `npm run dev` (Vite on 4316, API on 4317). |
| *"profile is already open in another window"* | Close the Postbench Chromium window or the other `postbench` process. One profile, one process. |
| *"needs you to log in"* | Expected on first use. Log in inside the Postbench browser window, leave it open, prepare again. |
| *"page layout may have changed"* | The platform moved something. The page is left open — finish with **Copy**, then update the selectors in `src/platforms/<platform>.ts`. |
| Generation is slow or times out | The `claude-cli` provider takes 10–30s. Raise `POSTBENCH_AI_TIMEOUT_MS` or switch to an API key. |
| *"does not accept … video/quicktime"* | Click **→ MP4** on the media card (needs FFmpeg). |

## Security

- The server binds **`127.0.0.1` only**. Nothing is exposed to your network.
- Media is served only from your draft's own media directory, addressed by draft and media id.
- **No passwords** are requested, stored, or typed. No cookie extraction. No CAPTCHA or 2FA bypass.
- Nothing is uploaded to third-party storage. Your files go from disk into the platform's own
  composer, and nowhere else.
- Your idea text and media *descriptions* are sent to whichever AI provider you configure.
  Use `POSTBENCH_AI_PROVIDER=ollama` or `=none` if you would rather they were not.
- Full error detail goes to your terminal; the UI only ever shows a readable message.

## MVP limitations

Being straight about what this does not do yet:

- Composer filling is **unverified against logged-in accounts** — see the table above.
- Instagram is the most likely adapter to break; its create flow has the most steps.
- No threads, no scheduling, no platform-side drafts, no per-platform link previews.
- One draft is edited at a time; two Postbench instances cannot share the browser profile.
- Desktop-first. Usable at phone width, not designed for it.
- Draft history is a flat list — no search, tags, or folders.
- The offline template fallback is deliberately dumb. It exists so the app still works with no
  AI configured, not to write good posts.

## Tests

```bash
npm run typecheck
npm test
```

**49 tests** covering draft schema validation, hashtag mutation, character counting (including
X's 23-character URL rule), platform media rules, generation-result parsing, the full server API
against a temp directory, and adapter ordering plus error mapping against a fake page.

> **No test opens a browser or touches a social platform.** The adapter tests use a test double;
> the server tests mock the platform module entirely. A real public post can never be created by
> the suite.

---

<div align="center">

**Generation and publishing are separate. That is the whole point.**

</div>
