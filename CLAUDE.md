# Claude Code Instructions

Follow [AGENTS.md](./AGENTS.md) for repository-wide rules.

Claude-specific notes:

- Treat `AGENTS.md` as the source of truth for project layout, commands, style, safety, and testing.
- Keep responses concise and implementation-oriented.
- Before editing, inspect the relevant files and current git status.
- Do not run destructive git commands unless the user explicitly requests them.
- When making frontend changes, prefer existing components, CSS variables, and `lucide-react` icons.
- When changing file operations or path handling, preserve NAS root safety and approval gates.
