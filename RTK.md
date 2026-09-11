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
- Assistant hook: **not installed**. rtk prints
  `[warn] No hook installed — run 'rtk init -g'` on every invocation. Installing
  it is a global change (`~/.claude`, settings patching) and has not been done.
