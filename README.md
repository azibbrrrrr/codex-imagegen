# codex-imagegen

Claude Code skill that generates or edits images through the Codex CLI's built-in `imagegen` skill. No OpenAI API key; it uses your Codex login.

## Install

1. Install and log in to Codex: `npm install -g @openai/codex && codex login`
2. Copy the skill:
   ```bash
   git clone https://github.com/azibbrrrrr/codex-imagegen
   cp -R codex-imagegen/skills/codex-imagegen ~/.claude/skills/
   ```
3. Check it: `node ~/.claude/skills/codex-imagegen/scripts/codex-imagegen.mjs status`

Requires Node 18+, macOS or Linux (Windows untested), codex-cli 0.16x or later.

## Use

```bash
S=~/.claude/skills/codex-imagegen/scripts/codex-imagegen.mjs
node $S generate --out ./art --name mascot -- "flat blue paper plane icon"
node $S edit in.png --out ./art -- "make the background transparent"
```

- `--model` overrides the default (`$CODEX_IMAGE_MODEL`, else `gpt-6.1-terra`). `--ref` repeats.
- `CODEX_BIN` points at a specific `codex` binary; `CODEX_HOME` at a non-default Codex home.
- Stdout prints `SAVED: <absolute path>`. Exit is non-zero if nothing was saved.
- Each run is one paid Codex turn (about 40 seconds to 3 minutes).

## License

MIT
