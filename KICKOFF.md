# Starting the build in Claude Code

## One-time, on your Mac
1. Unzip this kit so these files sit at the top of `~/Documents/Personal/projects/open-logs`
   (`CLAUDE.md`, `KICKOFF.md`, `docs/`, `.claude/`). The `.claude` folder is hidden in Finder: press Cmd+Shift+. to see it.
2. In Terminal:
   ```
   gh auth login        # GitHub, so Claude Code can create the repo
   wrangler login       # Cloudflare (install with: npm i -g wrangler, if missing)
   cd ~/Documents/Personal/projects/open-logs
   claude
   ```

## Paste this as your first message to Claude Code
```
Read CLAUDE.md, docs/PLAN.md, docs/ARCHITECTURE.md and docs/design/README.md.
You are the lead. Use the subagents in .claude/agents (backend, ui-builder, landing-page, security-reviewer).
Follow Git Flow and test-first exactly as CLAUDE.md says, and ask me before anything in the "Ask first" list.
Start with Phase 0. Show me your plan for Phase 0 first, then go once I say yes.
After each feature branch: tests green, security review PASS, merge to develop, tick the box in PLAN.md, tell me in two lines what changed.
```

## When to step in
- Phase 0: approve repo creation and installs.
- Before Phase 5: get Workers Paid ($5/mo), then approve creating Basin resources and the staging deploy.
- Phase 8: approve the release to `main`.
