# Antigravity IDE Adapter

Native Antigravity IDE support via customizations (`rules/`, `skills/`, and `hooks.json`).
The adapter installs ponytail's always-on rule, the six native skills, and the `PreInvocation`
lifecycle hook into Antigravity's customization directory (`~/.gemini/config` globally or
`<cwd>/.agents` per-project).

| File | Role |
|------|------|
| `hooks/antigravity-hooks.json` | Template: `PreInvocation` entry with a `PONYTAIL_DIR` placeholder. |
| `scripts/antigravity.js` | `install` / `uninstall`, sets up rules, skills, and merges hooks into `~/.gemini/config/` (or `<cwd>/.agents/` with `--project`). |
| `hooks/ponytail-mode-tracker.js` | `PreInvocation`: tracks `/ponytail` commands, extracts prompt from `transcriptPath` if needed, emits `injectSteps` JSON. |
| `hooks/ponytail-runtime.js` | Detects Antigravity (`ANTIGRAVITY_AGENT` / `ANTIGRAVITY_CONVERSATION_ID`), keeps mode state under `~/.gemini/.ponytail-active`, formats output as `injectSteps`. |

## Install and uninstall

```bash
git clone https://github.com/DietrichGebert/ponytail
node ponytail/scripts/antigravity.js install            # ~/.gemini/config, every project
node ponytail/scripts/antigravity.js install --project  # <cwd>/.agents, this project only
node ponytail/scripts/antigravity.js uninstall          # add --project for project scope
```

What the install script does:

- **Rule**: Copies `rules/ponytail.md` (the canonical lazy senior dev mode ruleset) to `<target>/rules/ponytail.md`. Antigravity IDE loads this unconditionally as an always-on rule.
- **Skills**: Copies the 6 skills (`ponytail`, `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`) to `<target>/skills/`. They become native slash/natural skills in Antigravity chat.
- **Hooks**: Merges the `ponytail` hook definition into `<target>/hooks.json`, replacing `PONYTAIL_DIR` with the checkout's absolute path (forward slashes, verified shell-safe). Unrelated hooks are kept intact.
- **Uninstall**: `node scripts/antigravity.js uninstall` removes ponytail's rule, skills, and hook entries, cleaning up empty directories and deleting `hooks.json` if only ponytail was registered. `node scripts/uninstall.js` cleans user-level Antigravity files alongside other platforms.

## Contract

Antigravity IDE uses the Antigravity customization discovery model:

| Scope | Customization Root | Rule Path | Skills Directory | Hooks File |
|-------|--------------------|-----------|------------------|------------|
| User / Global | `~/.gemini/config/` | `rules/ponytail.md` | `skills/` | `hooks.json` |
| Project | `<project-root>/.agents/` | `rules/ponytail.md` | `skills/` | `hooks.json` |

### Hook contract

Antigravity executes commands declared in `hooks.json` synchronously with context piped via JSON on stdin, expecting valid JSON on stdout.

- **Event**: `PreInvocation` runs before the model is called on each turn.
- **Input (stdin)**: includes `invocationNum`, `conversationId`, `transcriptPath`, `workspacePaths`, `artifactDirectoryPath`.
- **Output (stdout)**:
  - When injecting a message: `{"injectSteps": [{"ephemeralMessage": "<text>"}]}`
  - When silent (ordinary turns): `{}`
- **Mode Tracking**: `hooks/ponytail-mode-tracker.js` inspects `prompt` directly, or reads the latest `USER_INPUT` from `transcriptPath` when `prompt` is not passed on stdin. Mode switches (`/ponytail lite|full|ultra|off`) update `~/.gemini/.ponytail-active` and inject confirmation messages.
