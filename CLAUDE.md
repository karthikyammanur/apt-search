@AGENTS.md

## Claude Code notes
- A Stop hook runs `npm run check`. If it fails, fix it before ending your turn.
- Plan before editing: list the files you will touch and confirm they belong to your step.
- Use a read-only subagent for wide codebase searches so your context stays small.
