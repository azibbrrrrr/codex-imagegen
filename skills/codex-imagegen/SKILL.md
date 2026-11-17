---
name: codex-imagegen
description: Generate or edit image assets (mascots, illustrations, icons, empty-state art) through the Codex CLI's built-in imagegen skill, defaulting to the gpt-6.1-terra model. Use when the user asks for Codex imagegen, Codex image, terra, or real image assets rather than mockups. Works with codex-cli 0.16x and later.
---

# Codex imagegen

Script: `scripts/codex-imagegen.mjs`, next to this file (usually `~/.claude/skills/codex-imagegen/scripts/codex-imagegen.mjs`).

```bash
S=~/.claude/skills/codex-imagegen/scripts/codex-imagegen.mjs
node $S status
node $S generate --out "<dir>" --name growly-wave --ref "/path/with spaces/ref.jpg" -- "<prompt>"
node $S edit "<input.png>" --out "<dir>" -- "<edit request>"
```

- Pass each path as its own quoted argument. The prompt comes after `--`.
- `--model` overrides the default (`$CODEX_IMAGE_MODEL`, else `gpt-6.1-terra`). `--ref` can repeat.
- Output defaults to `./codex-images/`. Use a scratch dir unless the user names an asset folder in the repo.
- Stdout carries `SAVED: <absolute path>` lines. It exits non-zero if Codex fails or saves nothing.
- One run is one paid Codex turn, often 1–3 minutes. Run it in the background with Bash `run_in_background` and keep working. Don't fire several in parallel unless asked.
- Before using an image, Read it and check it. A first pass is a draft.

Fixes it carries over the old plugin:
- uses `--sandbox workspace-write` instead of the removed `--full-auto`;
- relocates any image Codex saves outside `--out` into it;
- skips cmux `codex` shims on PATH;
- closes stdin so `codex exec` doesn't wait on input;
- uses real argv parsing, so paths with spaces work.
