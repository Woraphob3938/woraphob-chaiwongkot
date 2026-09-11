# RTK — token-optimized shell proxy

`rtk` sits in front of shell commands and filters their output before it reaches
an agent's context. It is installed at `C:\Users\HP\.local\bin\rtk.exe` (v0.46.0)
and is already on `PATH`. Check savings with `rtk gain`.

## Rule

Prefix shell commands with `rtk`:

```bash
rtk git status
rtk git diff
rtk npm test
rtk npm run check
rtk rg "pattern"
rtk read path/to/file
```

## Commands that MUST NOT be called bare

`rtk` ships its own implementation for some names. When the name matches one of
its subcommands it runs **that** instead of the project's tool, which silently
replaces this repository's configuration:

| Avoid | Why | Use instead |
| --- | --- | --- |
| `rtk vitest …` | runs rtk's bundled vitest, so `tests/setup.ts` never loads and every `toBeInTheDocument()` fails with *Invalid Chai property* | `rtk npm test`, `rtk npx vitest run …` |
| `rtk tsc …` | runs its own compiler pass instead of `npm run typecheck` | `rtk npm run typecheck` |
| `rtk npm run <script>` | safe — the script resolves the project binary | — |
| `rtk npx <tool>` | safe — verified that `rtk npx vitest` uses the local vitest | — |
| `rtk powershell …`, `rtk uv …` | safe — resolved through `PATH` | — |

A name rtk does not know is resolved through `PATH` and passes through, so
`rtk powershell -File scripts/foo.ps1` still works.

**Verify before trusting a result.** The bundled-tool trap produces *false
failures*, which is worse than a false pass: it looks like the change broke the
suite. If a test or typecheck result through `rtk` disagrees with the same
command run through `npm`, believe `npm` and report the discrepancy.

## Meta

```bash
rtk gain              # token savings summary
rtk gain --history    # recent per-command savings
rtk proxy <cmd>       # run a command with no filtering
rtk summary <cmd>     # run a command and print a heuristic summary
rtk --version
```

## Current state on this machine

- Project instructions: `AGENTS.md` references this file, installed with
  `rtk init --codex`.
- Global hook: **installed** with `rtk init -g --auto-patch`. It registers
  `rtk hook claude` as a `PreToolUse` hook in `~/.claude/settings.json`, so
  Claude Code rewrites `git status` into `rtk git status` on its own. Verify with
  `rtk init --show` (expect `[ok] Hook`).

### What the hook does not cover

`rtk hook` only speaks the hook protocols of Claude Code, Cursor, Gemini CLI,
GitHub Copilot, Factory Droid and Mistral Vibe. There is **no DeepSeek Harness
target**, so a session running in DSH gets no automatic rewriting. In DSH the
savings depend on the agent prefixing commands itself, which is why this file
exists and why the safe forms below matter.
