# git-octopus

A Git graph client for Visual Studio Code — view your repository's commit graph and perform Git
actions from it.

> **Clean-room note.** git-octopus is an independent, from-scratch reimplementation inspired by the
> _Git Graph_ extension. It reuses none of Git Graph's source code or assets. It is licensed under
> the MIT License and is not affiliated with or endorsed by the original project.

## Install

Search for **Git Octopus** in the VS Code Extensions view, or install it from the
[Marketplace](https://marketplace.visualstudio.com/items?itemName=locpham.git-octopus) or
[Open VSX](https://open-vsx.org/extension/locpham/git-octopus).

To build and install it from source instead:

```bash
git clone https://github.com/locphamduc96/git-octopus.git
cd git-octopus
pnpm install
pnpm package
code --install-extension git-octopus.vsix --force
```

Reload the window, then open the view from the Git Octopus item in the status bar, or run
**Git Octopus: Open Git Octopus** — or **Open Git Octopus in Editor Tab** — from the Command Palette.

Requires VS Code 1.90 or newer, Node 20+, pnpm, and `git` 2.24 or newer on your PATH.

## What it does

Commit graph with branch lanes and colours, in four lane styles · branch, tag and stash chips, and
a `HEAD` chip when it is detached · commit details with the file list as a flat list or a folder
tree · file icons from whichever icon theme you use · working tree: stage, unstage, discard, stash,
commit, undo commit · diff any file, or compare two commits with Ctrl/Cmd + click · fetch, pull,
push and force-push with confirmation, against remotes that ask for credentials · 20+ Git actions
from the commit menu, asked in the view's own dialogs · right-click a chip to act on that ref, or
hover the ref column to read every name in full · a Git identity per repository, matched to the
remote · find (Ctrl+F) · several repositories in one workspace.

## Screenshots

Taken against a demo repository; the full set lives in [docs/screenshots](docs/screenshots).

![The commit graph, with the working tree beside it](docs/screenshots/01-graph-overview.png)

![Inline diff with syntax highlighting and the change ruler](docs/screenshots/04-diff-syntax-highlight.png)

![Drag a branch onto another to merge, rebase or fast-forward](docs/screenshots/05-branch-drag-merge.png)

![Clean up stale local branches in one pass](docs/screenshots/06-branch-cleanup.png)

## Architecture

pnpm monorepo (architecture decisions live in the author's `project-notes/`, outside this repo):

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

Third-party assets:

- [VS Code Codicons](https://github.com/microsoft/vscode-codicons) — icon font, CC BY 4.0 © Microsoft.
- [GitHub Octicons](https://github.com/primer/octicons) — the branch, remote and checked-out glyphs
  drawn in the ref chips, MIT © GitHub Inc.
