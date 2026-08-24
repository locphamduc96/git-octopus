# Git Octopus

View a Git graph of your repository and perform Git actions from it, inside Visual Studio Code.

> Independent, from-scratch reimplementation inspired by _Git Graph_. Reuses none of its source or
> assets. MIT licensed; not affiliated with or endorsed by the original project.

![The commit graph, with the working tree beside it](docs/screenshots/01-graph-overview.png)

## Features

- **Commit graph** with branch lanes and colours, author avatars on the nodes, stash and
  uncommitted-changes entries, and resizable columns you can switch off. Four lane styles —
  rounded, curved, angular, diagonal. Ticket references (`[GAME-421]`) and conventional-commit
  types (`feat`, `fix`, `chore`, …) render as chips, and hovering a row or branch chip highlights
  that branch's whole line. Rest on an avatar to see who wrote the commit. A long-lived branch
  keeps its own lane through fork points instead of drifting left.
- **Commit details**: message, author and committer, parents, and the changed files as a flat list or
  a folder tree — with the file icons from whichever icon theme you already use.
- **Working tree**: stage, unstage and discard per file, stage or unstage everything, stash, commit,
  and undo the last commit.
- **Diffs in the view**: any file's changes open in an inline panel with syntax highlighting and an
  overview ruler of every change — or Ctrl/Cmd + click a second commit to compare two commits.
  ↑/↓ step through the commit's files while a diff is open; Alt + ↑/↓ still move between commits.
- **Git actions**: checkout, branch, merge, rebase, cherry-pick, revert, reset, tag, and the stash
  actions, from the commit's context menu; drag one branch chip onto another to merge, rebase or
  fast-forward; fetch, pull, push and force-push ask before running. Merge options, squash and
  reword messages and the confirmations are asked in the view's own dialogs, with a real
  multi-line editor for commit messages.
- **Refs where you clicked them**: right-click a branch, remote branch or tag chip and the menu
  belongs to that ref, named in the label — no second question about which ref you meant. Hover the
  ref column and it unfolds, every ref on the row at full length, still draggable and still
  right-clickable.
- **Checkout that keeps up**: checking a branch out from its remote finds the local branch even
  when it has fallen behind, and brings it up to date in the same step — never over uncommitted
  work, and switchable off. A detached HEAD is marked in the graph, with one click back to the
  branch you left.
- **Remotes that ask for credentials** work without a terminal: git's prompt is answered through
  VS Code, and nothing secret reaches a log or notification.
- **AI commit**, opt-in: the wand beside Commit hands your changes to an agent CLI you already have
  installed and logged in — Claude Code, Codex, Gemini, Copilot, OpenCode or Qwen Code — and it
  writes the message, or a split into several commits you can edit, regroup and approve before
  anything is written. No API key is stored; generated assets, binaries and any glob you exclude
  are sent by name only.
- **Branch cleanup**: scan local branches by age, see which are merged or have lost their remote,
  and delete a batch in one pass — every result comes back with the hash to undo it.
- **Git identities per repository**: keep an identity per client, each with one or more remote
  patterns, and apply it to a repository without touching your global config — optionally applied
  on its own when a repository's remote matches exactly one of them.
- **Find** with Ctrl+F, several repositories in one workspace, and a view you can open as an editor
  tab.

## Managing multiple Git identities

If you commit under more than one name — a work address, a personal one, one per client — the
**Identity** tab in the view's settings keeps them as saved identities and applies the right one to
each repository.

- **Save an identity** with a label, name and email. The tab offers to save the one you are
  committing with right now when no saved identity carries that email yet, and the **This
  workspace** table below lets you save an account a repository already uses.
- **Apply it to a repository** with one click. The identity is written to that repository's own
  config; your global Git config is never changed, and the global identity stays visible as a
  card you can switch back to.
- **Match by remote**: give an identity one or more patterns, comma-separated, and a repository
  whose remote URL contains one of them — `github.com/client-a, gitlab.client-a.io` — gets that
  identity suggested on the control bar, one click away, whenever it is committing as something
  else.
- **Auto-apply identity by remote** (off by default) goes one step further: a repository with no
  identity of its own whose remote matches exactly one saved identity gets it applied and says so.
  Two matches means no guess — you only get the warning.
- **A question before a wrong commit**: when a repository's remote suggests a different identity
  from the one about to commit, the Commit button asks first — switch to the suggested identity
  and commit, or commit as you are. Cancelling keeps your message.
- **This workspace**: with two or more repositories open, the Identity tab lists each one with the
  email it commits as, marking the ones that override the global identity.

Identities live in your VS Code settings on this machine (`gitOctopus.identities`) and are never
sent anywhere by the extension.

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

VS Code 1.90 or newer, and `git` 2.24 or newer on your PATH.

## Privacy

No telemetry, no tracking — the extension talks to your local `git` and nothing else, with one
exception: the **Fetch avatars** setting (off by default) loads author images from gravatar.com,
which sends a hash of each author's email address to that service. Nothing is fetched until you
turn it on in the view's settings.

## Licence

MIT — see [LICENSE](LICENSE). Bundled third-party components and their licences are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
