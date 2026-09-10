---
name: postbench
description: Use when the user wants to turn something they built or changed into social posts — "make today's post", "post about this change", "write a LinkedIn/X/Instagram/Facebook post about X", "draft social copy for this release". Summarizes the update and hands it to Postbench, which opens a local browser UI for review. Never publishes.
---

# Postbench

Postbench turns an idea into four platform-specific drafts (LinkedIn, Instagram, Facebook, X),
opens a local review UI, and — on the user's click — fills the real composers in a persistent
browser. **The user always performs the final Publish click.**

## Your job

1. **Work out what to say.** Only inspect what the user asked you to inspect.
   - They named a change, feature, or file → read that.
   - They said "today's changes" / "this release" / "the diff" → then, and only then, look at
     `git log`, `git diff`, or the changelog.
   - They just gave you a sentence → use the sentence. Do not go digging.

2. **Summarize the meaningful product change**, not the implementation.
   - Good: "Faultbench can now search HVAC manuals offline — download once, then look up a
     procedure with no signal."
   - Bad: "Refactored the search index to use a local SQLite FTS5 table."
   - 1–3 sentences. Plain language. Say what changed and who it helps.
   - If the diff contains nothing user-visible, say so and ask what they want to post about
     instead of inventing a feature.

3. **Hand it to Postbench:**

   ```bash
   postbench create --input "<your summary>" [--url "<link>"]
   ```

   This creates a draft, starts the local server on 127.0.0.1, and opens the browser UI.
   The command stays in the foreground while the server runs — start it in the background
   (or tell the user to run it themselves) so you are not blocked.

4. **Tell the user what to do next**, briefly:
   - Drag in screenshots or a video, or paste a screenshot with ⌘V.
   - Edit each platform card; use Shorter / More casual / More technical / Less promotional.
   - Click hashtag chips to add or remove them, and pick which media goes to which platform.
   - Click **Prepare Selected Posts** → the composers open, filled in.
   - **They click Publish.**

5. **Stop there.** Do not attempt to publish, and do not drive the platform UIs yourself.

## Other commands

```bash
postbench list                 # existing drafts
postbench open <draft-id>      # reopen a draft in the UI
postbench generate <draft-id>  # regenerate in the terminal, no UI
postbench doctor               # check AI provider, Playwright, FFmpeg, data dirs
```

## Rules

- **Never publish, and never click Publish/Post/Share/Tweet** on the user's behalf.
- Do not ask for social passwords. The user logs in themselves, once, in the Postbench browser.
- Do not invent product claims, metrics, or customer quotes. If you are unsure a claim is true,
  leave it out and mention the gap.
- Brand voice lives in `config/brand.json` (or `~/.postbench/brand.json`). Read it if you need
  to match tone; do not restate it in the summary.
- If the user asks for a thread, or for a platform Postbench does not support, say what
  Postbench can do rather than improvising around it.
