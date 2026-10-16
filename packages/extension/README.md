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
  keeps its own lane through fork points instead of drifting left. Drag a column header to reorder
  the columns, and switch on **Changes** to see each commit's lines added and removed — read only
  for the rows on screen, so a large repository stays fast.
- **Upstream drift on every branch**: a local branch's chip shows how far it is ahead of or behind
  the branch it tracks, and **auto-fetch** (every minute by default; 5, 15, 30 or 60 minutes, or
  off) keeps those counts true. It pauses while the window is in the background and gives up after
  repeated failures rather than asking for a password again and again.
- **Show only what matters**: **Show Only** a branch to draw it alone, then **Also Show** others
  beside it; **Show Only Related Branches** on the checked-out branch keeps it, its upstream and the
  main line. **Hide** a noisy branch or tag — its own commits drop out, the history it shares stays.
  Pills in the control bar say what is filtered and undo it.
- **Pin to Left**: pin a branch and its line holds the left edge of the graph, so every other
  branch reads against it; the pin icon on the Graph header jumps to it.
- **Commit details**: message, author and committer, parents, and the changed files as a flat list or
  a folder tree — with the file icons from whichever icon theme you already use. A merge commit
  lists what it brought in: its files against the branch it was merged into.
- **Working tree**: stage, unstage and discard per file, stage or unstage everything, stash all or
  **stash one file**, commit — with **push after committing**, **skip hooks** for one commit, and
  your `commit.template` filled in — and undo the last commit; a commit a hook refuses comes back
  with your message. Or **pick lines**: in a file's diff, unified or side by side, click line
  numbers (Shift+click for a range) to stage, unstage or discard just those lines, or a whole hunk
  from its header. The diff re-reads the file before applying, so a picked line that changed
  meanwhile is refused, not misapplied.
- **Diffs in the view**: any file's changes open in an inline panel with syntax highlighting and an
  overview ruler of every change — unified or **side by side**, with **word wrap** and **ignore
  whitespace** toggles, and the **words that changed** marked inside each edited line. Ctrl/Cmd +
  click a second commit to compare two commits, or the Uncommitted row to **compare a commit with
  the working tree**; **Restore File from this Commit** puts a file back as it was, and **Apply This
  File from Stash** takes one file out of a stash — untracked ones included — leaving the stash
  alone. A changed **image** shows before and after side by side or overlaid, small sprites blown
  up pixel by pixel; a file **Git LFS** stores is marked on its row, and its diff names the objects
  each side points at instead of the pointer's text.
- **History and blame**: **File History** lists every commit that touched a file, across renames —
  ↑/↓ walk it with the diff open. **Blame** shows who last changed each line, at any commit or in
  the working tree; click an annotation to jump to its commit.
- **Git actions**: checkout, branch, rename, merge, rebase, cherry-pick, revert, reset, lightweight
  and annotated tags, the stash actions, and setting or clearing a branch's upstream; drag one
  branch chip onto another to merge, rebase, fast-forward or reset it, or onto a remote branch to
  rebase onto it or push to it; push a branch without checking it out; fetch,
  pull, push and force-push ask before running. Deleting an unmerged branch offers a force delete
  instead of failing. Merge options, squash and reword messages and the confirmations are asked in
  the view's own dialogs, with a real multi-line editor for commit messages.
- **Interactive rebase**: **Interactive Rebase from Here…** on a commit below HEAD lists every
  commit above it — reorder them, and pick, reword, squash, fix up or drop each one (P / R / S / F /
  D). Or drag a local branch onto another and choose **Interactive Rebase A onto B…** to move it
  there, editing its commits on the way. The commits are proved unchanged before anything runs; a
  conflict pauses the rebase for you to resolve and continue from the banner.
- **Cherry-pick several commits**: select them and **Cherry Pick N Commits…** opens an editor — put
  them in the order to apply, leave some out, record where each came from (`-x`), or stage the
  changes without committing them.
- **Conflicts**: a conflicted file opens in VS Code's merge editor, or takes the current or incoming
  side whole — and the conflict markers can be put back if the wrong side was taken.
- **Undo and Redo**: the last graph action that moved a branch or HEAD — a merge, rebase, reset,
  cherry-pick, squash or branch change — is undone with the Undo button in the control bar, and
  Redo puts it back. Everything is checked again before either runs, and a dirty working tree is
  refused rather than overwritten.
- **Remotes**: add a remote (fetched straight away) or remove one from the Remotes tab in the
  view's settings.
- **Worktrees**: the Worktrees tab lists every worktree of the repository — open one in a new
  window, add one for an existing or a new branch, remove one, or prune those whose folders are
  gone. A branch checked out in another worktree offers that worktree in its menu instead of a
  checkout git would refuse; any other branch offers **Create Worktree for…**.
- **Refs where you clicked them**: right-click a branch, remote branch or tag chip and the menu
  belongs to that ref, named in the label — no second question about which ref you meant. Hover the
  ref column and it unfolds, every ref on the row at full length, still draggable and still
  right-clickable.
- **Checkout that keeps up**: every way of checking a branch out — double-click its chip or the
  faded branch name on a commit, the menu, or its remote chip — finds the local branch even when it has fallen behind, and brings it up to date in
  the same step, never over uncommitted work and switchable off. Checked out from its remote chip,
  a branch that has diverged is checked out first and then you choose: merge, rebase, or reset
  onto the remote; one that is only ahead offers to push it up or reset it back, and says whether
  the commits a reset drops still live on another branch. A detached HEAD is marked in the graph,
  with one click back to the branch you left.
- **Pull strategy**: the Pull button follows your git config by default, or uses fast-forward if
  possible, fast-forward only, or rebase — so a repository set to write a merge commit on every
  pull can still be pulled clean. The pull menu offers each one for a single pull.
- **Remotes that ask for credentials** work without a terminal: git's prompt is answered through
  VS Code, and nothing secret reaches a log or notification.
- **AI commit**, opt-in: the wand beside Commit hands your staged changes to an agent CLI you
  already have installed and logged in — Claude Code, Codex, Gemini, Copilot, OpenCode or Qwen Code —
  and it writes the message, or a split into several commits you can edit, regroup and approve
  before anything is written. Each step of the run is shown while it works. No API key is stored;
  generated assets, binaries and any glob you exclude are sent by name only, and the agent runs in
  a folder of its own, never inside your repository.
- **AI explain**, with the same agent: **Explain Commit with AI** on a commit, **Explain … with AI**
  on a branch (its commits that the checked-out branch, or the main line, does not have), or the ✨
  button beside the wand for the uncommitted changes. The account opens beside the graph as a
  Markdown document — a summary, the changes by purpose, and what is worth checking.
- **Branch cleanup**: scan local branches by age, see which are merged or have lost their remote,
  and delete a batch in one pass — every result comes back with the hash to undo it.
- **Git identities per repository**: keep an identity per client, each with one or more remote
  patterns, and apply it to a repository without touching your global config — optionally applied
  on its own when a repository's remote matches exactly one of them.
- **Signed commits**: the Signing tab turns commit and tag signing on for a repository, with GPG,
  SSH or X.509 and the key to use — written to that repository's config, never the global one —
  and says what would stop it working, such as a bad `gpg.format` in your global config. Switch on
  **Show signatures on the graph** and a shield beside each signed commit says whether its
  signature checks out; the commit details name the signer and the key.
- **In the Panel or an editor tab**: the graph opens in the bottom Panel or as an editor tab you
  can split, drag to another group or move into its own window. The octopus button on the editor
  title bar opens it, **Move to Editor Tab** / **Move to Panel** swap between the two, and the
  **Default location** setting decides where **Open Git Octopus** goes. An open tab is brought
  forward rather than opening a second graph.
- **Gets along with other Git tools**: every git command runs in turn, a write that meets a lock
  another tool holds for a moment waits it out, and reading the working tree never takes the
  index lock — so a commit made in a terminal or another client is not refused because the graph
  was refreshing. A lock file left behind by an interrupted command is reported as exactly that,
  with an offer to remove it.
- **Find** with Ctrl+F highlights every matching commit in the full graph — Enter and Shift+Enter
  step through them, with match case, regular expressions, and a filter mode that hides the rest.
- **Keyboard**: ↑/↓ by date, Alt+↑/↓ along the selected commit's branch, ←/→ to the lane beside it;
  while the graph has focus, Cmd/Ctrl+B creates a branch at the selected commit and Cmd/Ctrl+L
  fetches — everywhere else those keys stay VS Code's. Press **?** for the full list.
- Several repositories in one workspace, and the **submodules** inside them: a submodule's row in
  the working tree says whether it has new commits, edits or untracked files of its own; its diff
  shows the commit it moves from and to, with **Open submodule** to switch to its graph; and every
  checked-out submodule is in the repository picker.

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

**AI commit splits the staged changes into commits you review before anything is written**

![AI commit plan editor](docs/screenshots/10-ai-commit-plan.png)

**A merge commit lists what it brought in**

![Files of a merge commit](docs/screenshots/09-merge-commit-files.png)

**Drag a branch onto another to merge, rebase or fast-forward**

![Branch drag and drop](docs/screenshots/05-branch-drag-merge.png)

**Clean up stale local branches in one pass**

![Branch cleanup dialog](docs/screenshots/06-branch-cleanup.png)

**Settings, with the pull strategy and auto-fetch interval**

![Settings dialog](docs/screenshots/07-settings.png)

## Requirements

VS Code 1.90 or newer, and `git` 2.24 or newer on your PATH.

## Privacy

No telemetry, no tracking — the extension talks to your local `git` and nothing else, with one
exception: the **Fetch avatars** setting (off by default) loads author images from gravatar.com,
which sends a hash of each author's email address to that service. Nothing is fetched until you
turn it on in the view's settings.

Two things reach beyond your machine through tools you already use, never through the extension
itself: **auto-fetch** runs `git fetch` against your repository's own remotes (set it to Off in the
settings to stop it), and **AI commit** and **AI explain**, only when you press the wand, the ✨
button or an Explain menu entry, hand the changes in question to the agent CLI you picked.

## Licence

MIT — see [LICENSE](LICENSE). Bundled third-party components and their licences are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
