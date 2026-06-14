# Agent CLI

`src/cli.js` drives content generation from the terminal against the **same SQLite
database** the web app uses, so the app and the CLI stay in sync. It's the "agent"
half of the hybrid interface: the web app is the surface for the team, the CLI is the
fast path for ad-hoc runs (and for an agent like Claude Code to call).

It reuses the exact same output registry (`src/services/outputs.js`) and generation
services as the web app, so output behaviour is identical.

## Setup

Needs the same `.env` as the app (notably `ANTHROPIC_API_KEY`). No server required —
the CLI opens the DB directly.

## Commands

```bash
node src/cli.js list                              # recordings + intro/final/content status
node src/cli.js outputs                           # list distribution output keys
node src/cli.js show <recordingId>                # per-output status for a recording
node src/cli.js intro <recordingId>               # generate intro script (from raw transcript)
node src/cli.js generate <recordingId> <key>      # generate one distribution output
node src/cli.js generate <recordingId> all        # generate all distribution outputs
node src/cli.js feedback <recordingId> <key> up|down [note...]
```

`<key>` is a distribution output key, e.g. `rahul-x`, `youtube`, `youtube-description`,
`substack-show-notes` (run `node src/cli.js outputs` for the full list).

## Notes

- **Distribution** outputs need a final transcript set on the recording (upload it in
  the app, or send the Content Editor output to Distribution). The CLI does not create
  episodes or upload transcripts — it generates against what's already there.
- **Intro** generates from the recording's raw transcript.
- Feedback recorded via the CLI shows up on the Taste Prompts page just like in-app
  feedback, and feeds the "Improve from feedback" prompt tuning.
