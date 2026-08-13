# git-octopus

A Git graph client for Visual Studio Code — view your repository's commit graph and perform Git
actions from it.

> **Clean-room note.** git-octopus is an independent, from-scratch reimplementation inspired by the
> _Git Graph_ extension. It reuses none of Git Graph's source code or assets. It is licensed under
> the MIT License and is not affiliated with or endorsed by the original project.

## Architecture

pnpm monorepo (see [ADR-0001](../workspace-git-octopus/project-notes/04-decisions/ADR-0001-architecture.md)):

```
packages/
├── shared/        # type-only: domain model + host↔webview message protocol
├── graph-layout/  # pure engine: Commit[] → GraphRow[]
├── extension/     # VS Code host (hexagonal: core / adapters / app)
└── webview/       # Svelte 5 + Vite UI (feature-sliced)
```

## Development

```bash
pnpm install
pnpm dev          # watch: build webview + extension
pnpm test         # run unit tests (Vitest)
pnpm lint
pnpm package      # produce a .vsix
```

Then press <kbd>F5</kbd> in VS Code to launch the Extension Development Host.

## License

[MIT](LICENSE) © 2026 locpham
