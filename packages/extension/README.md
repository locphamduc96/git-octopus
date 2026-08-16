# Git Octopus

View a Git graph of your repository and perform Git actions from it, inside Visual Studio Code.

> Independent, from-scratch reimplementation inspired by _Git Graph_. Reuses none of its source or
> assets. MIT licensed; not affiliated with or endorsed by the original project.

![The commit graph, with the working tree beside it](docs/screenshots/01-graph-overview.png)

## Features

- **Commit graph** with branch lanes and colours, author avatars on the nodes, stash and
  uncommitted-changes entries, and resizable columns you can switch off. Ticket references
  (`[GAME-421]`) and conventional-commit types (`feat`, `fix`, `chore`, …) render as chips, and
  hovering a row or branch chip highlights that branch's whole line.
- **Commit details**: message, author and committer, parents, and the changed files as a flat list or
  a folder tree — with the file icons from whichever icon theme you already use.
- **Working tree**: stage, unstage and discard per file, stage or unstage everything, stash, commit,
  and undo the last commit.
- **Diffs in the view**: any file's changes open in an inline panel with syntax highlighting and an
  overview ruler of every change — or Ctrl/Cmd + click a second commit to compare two commits.
- **Git actions**: checkout, branch, merge, rebase, cherry-pick, revert, reset, tag, and the stash
  actions, from the commit's context menu; drag one branch chip onto another to merge, rebase or
  fast-forward; fetch, pull, push and force-push ask before running.
- **Branch cleanup**: scan local branches by age, see which are merged or have lost their remote,
  and delete a batch in one pass — every result comes back with the hash to undo it.
- **Find** with Ctrl+F, several repositories in one workspace, and a view you can open as an editor
  tab.

## Screenshots

**Inline diff with syntax highlighting and the change ruler**

![Inline diff panel](docs/screenshots/04-diff-syntax-highlight.png)

**Drag a branch onto another to merge, rebase or fast-forward**

![Branch drag and drop](docs/screenshots/05-branch-drag-merge.png)

**Hover highlights the branch under the pointer**

![Branch hover highlight](docs/screenshots/02-branch-hover-highlight.png)

**Clean up stale local branches in one pass**

![Branch cleanup dialog](docs/screenshots/06-branch-cleanup.png)

## Requirements

VS Code 1.90 or newer and `git` on your PATH.

## Licence

MIT — see [LICENSE](LICENSE). Bundled third-party components and their licences are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
