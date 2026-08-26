# Changelog

## 0.19.1

- The graph now shows the working tree as soon as its tab comes forward. A file changed while
  another Panel tab covered the view was counted on the badge but left out of the graph, so the
  **Uncommitted Changes** row only appeared after the view was reloaded.

## 0.19.0

### AI commit

- **A wand beside Commit writes the commit for you.** It drives an agent CLI you already have
  installed and logged in — Claude Code, Codex CLI, Gemini CLI, Copilot CLI, OpenCode or Qwen Code
  — so no API key is ever stored in the extension. Agents missing from your `PATH` are listed but
  cannot be picked.
- **One commit, or a split into several.** When the changes cover more than one thing, the plan
  comes back as several commits: a tab per commit, each with its own subject, body and file list.
  A file can be moved to another commit from a dropdown, and one click collapses the whole plan
  back into a single commit. Nothing is written until you approve it.
- **The commits are created in the order shown**, each with only its own files staged. If one
  fails, the run stops and says "created 3 of 5" — what was committed is real and is never rolled
  back. A plan whose files no longer match the working tree is refused rather than committed
  against changed content.
- **The run outlives the dialog.** The agent runs host-side, so you can hide the dialog, switch
  panel tabs or close the view while it thinks; reopening shows the result. A finished plan is
  restored as long as the changed files are the same, and can be regenerated for a fresh one.
  Cancelling kills the process, and an agent that never answers is given up on after 120 seconds.
- **What leaves your machine is bounded and visible.** Every changed file is named to the agent,
  but only source diffs ride along: files over 50 KB are described, not read, each diff is cut at
  400 lines, and the whole prompt is capped. Generated or editor-owned files — `.meta`, `.scene`,
  `.prefab`, lockfiles, `dist/`, minified output — and binaries are sent by name only. The dialog
  says so before you pick an agent; picking one is what records your consent.
- **Never send this file**: `gitOctopus.aiCommit.excludePatterns` takes glob patterns whose
  content is never sent, whatever their type. The files are still named, so the agent can put them
  in the right commit.
- **Settings → AI** holds the agent, the model and the thinking level, each remembered per agent,
  so Claude on `haiku` and Codex on `gpt-5-mini` can both be configured and switched between.
  Commit messages are a light task; the CLI's own default model is usually far more than they
  need. The same values are settable as `gitOctopus.aiCommit.claudeModel`, `codexModel`,
  `geminiModel`, `copilotModel`, `opencodeModel`, `qwenModel`, `claudeThinking` and
  `codexThinking`.

### The changed-file count, where Source Control puts it

- **The activity-bar icon carries the same red badge**, and so does the panel view's title: the
  number of files changed in the active repository. It is primed when VS Code starts, so the count
  is there before the graph has ever been opened, and it follows edits made outside the editor.

### Fixes

- The view no longer resets when another tab in the Panel covers it — an open AI commit plan, the
  scroll depth and the selected commit survive going away and coming back.

## 0.18.0

### Identities

- **The Identity tab offers to save the account you are already using.** On a fresh install, or
  whenever the identity committing in this repository has no saved card yet, a card invites you to
  save it — one label away from a reusable identity.
- **This workspace**: with two or more repositories open, the tab lists every repository with the
  email it commits as and marks the ones overriding the global identity. A repository using an
  account you have not saved gets a **Save…** of its own.
- **Commit asks before going out under a mismatched identity.** When the repository's remote
  suggests a different saved identity, the Commit button offers to switch and then commit, or to
  commit as you are. Cancelling keeps the message. The switch is confirmed before the commit runs,
  so the commit can never beat it. Amend is not interrupted.
- The multi-account flow is now described in the README.

### Browsing a commit's files

- **↑/↓ walk the files while a diff is open.** With a diff showing in the view, the arrow keys,
  PageUp/PageDown and Home/End step through the panel's files in the order they are listed —
  sections, folders and all — opening each one's diff, and stop at the ends rather than spilling
  into the next commit. The file being read is highlighted in the panel, scrolled into view, and a
  folder folded over it opens. Alt + ↑/↓ still move between commits without closing the diff; with
  no diff open nothing changes.

### Fixes

- The branch chip in the changes header had its top and bottom borders clipped; it is drawn as a
  proper chip now.

## 0.17.0

### Refs in the graph

- **Right-clicking a chip acts on that ref.** The menu belongs to the branch, remote branch or tag
  you clicked, and names it in the label — `Delete feature/ZG-2490…` — instead of running the
  commit menu and then asking again which of the row's refs you meant. Right-clicking the row
  still opens the commit menu, with the refs on that commit as one submenu each. Chips inside the
  `+N` popover answer to right-click too, and the popover stays put while their menu is open.
- **Hovering a ref cell unfolds the whole column.** Every ref on the row is listed vertically at
  full length, in place of the chips it replaces, so a name cut off by the column width can be
  read without aiming at the `+N` badge. It only unfolds when there is something to unfold — a
  hidden chip, or a name being ellipsised. The unfolded chips drag, drop, double-click and
  right-click exactly like the ones in the row, and the panel slides back into view when a long
  name would run off the edge.
- Creating a branch from a commit now checks it out as well.

### Graph lanes

- **A long-lived branch keeps its lane instead of drifting left at a fork point.** When several
  lanes are waiting for the same commit, the one whose straight run started higher up takes it, and
  a lane opened as a merge's second parent never takes the commit from the line that merged it. So
  `master` runs straight down its own column even while you are on a feature branch with
  uncommitted changes, and the feature bends into it rather than the other way round. Colours,
  lane widths and the edges are unchanged.

### Identities

- **Auto-apply identity by remote**, off by default — changing identity changes commit metadata, so
  it is opt-in. With it on, opening a repository that has no identity of its own, whose remote
  matches exactly one saved identity, sets that identity for the repository and says so. A
  repository that already has its own identity is never touched, and two matching identities means
  no guess: the warning on the account button stays as before.
- An identity can carry several remote patterns, comma-separated, so one client on a GitHub org and
  a self-hosted GitLab is a single identity.
- The **In use** pill now appears in one place only. A saved identity identical to your global one
  says so, instead of showing a pattern that is doing nothing.

### Fixes

- Two remotes can be configured whose names make the same remote-tracking ref path — git itself
  cannot tell them apart there. Checkout, fetch and delete now refuse and name both remotes rather
  than acting on a guess.
- No separator is drawn at the top of a menu or submenu, and the `+N` badge is the same height as
  the chips beside it.

## 0.16.0

Everything since 0.12.1. Versions 0.13–0.15 were built but never published, so their changes are
listed here.

### Authentication

- **Fetch, pull and push now work against remotes that ask for credentials.** The extension runs
  `git` without a terminal, so a remote with no stored credential used to fail outright with
  `fatal: could not read Username`. It now asks in VS Code and passes the answer through.
  Credentials are never written to logs, traces or notifications, and each prompt is bound to the
  single git command that raised it.
- Declining an SSH confirmation stops the operation. The answer is carried as the askpass process's
  exit status, which is what OpenSSH reads for agent-key and host-key confirmations.
- A prompt whose git command has already given up no longer blocks the next one: it is taken off
  the screen, and the queue moves on.

### Checking out

- Checking out a branch from its remote no longer fails with "branch already exists" when a local
  branch of that name has fallen behind the remote — it checks the local branch out instead.
- That checkout also brings the branch up to date when it has only fallen behind. Never on a
  branch with commits of its own, never while the working tree holds uncommitted work — including
  untracked files — and switchable off with **Fast-forward on checkout** in settings.
- Remote-tracking branches are addressed by their full ref path, so a remote whose name contains a
  slash acts on the branch you picked, and one whose name begins with a dash cannot be read as a
  command-line option.
- A detached HEAD is now visible: the commit it sits on carries a `HEAD` chip, and the bar that
  reports the state carries the ways out of it — back to the branch you left, a new branch here,
  or scroll to the commit. Scrolling to it loads more history when the commit is below the loaded
  page, and says so if it still cannot be found. **Back to** refuses, rather than guessing, when
  the repository has moved since the bar was drawn.

### Dialogs

- Merge options, squash and reword messages, and the force-push confirmation are now asked in the
  product's own dialogs rather than VS Code's quick-pick and input box. Squash and reword get a
  real multi-line editor, so a commit body can be written and edited in full.
- Actions started from the sidebar or the Command Palette still use native dialogs, and
  credentials always do.

### Graph and chips

- New graph style **Curved**: the same rounded lanes, bent as far as the row allows, so a branch
  reads as one continuous arc rather than a lightly clipped corner.
- Resting on a commit's avatar for two seconds shows who wrote it: name, email, and when.
- Menu toggles draw their tick against the right edge, so a column of them reads down the ticks.

## 0.12.1

- The activity-bar icon now opens the graph in the Panel instead of leaving an empty sidebar view;
  the Explorer stays visible when it does.
- Diffs open in the Panel by default, next to the graph, instead of in an editor tab.

## 0.12.0 — first Marketplace release

Everything below is part of the initial public release.

- Commit graph with branch lanes and colours, stash and uncommitted-changes entries, author
  avatars (opt-in), and resizable columns.
- Ticket references (`[ABC-123]`) and conventional-commit types (`feat`, `fix`, …) rendered as
  chips; hovering a row or branch chip highlights that branch's whole line.
- Commit details with the changed files as a flat list or folder tree, using your icon theme.
- Inline diff panel with syntax highlighting (Dark+/Light+, matched to your colour theme) and an
  overview ruler of every change; compare two commits with Ctrl/Cmd + click.
- Working tree: stage, unstage, discard, stash, commit, amend, undo commit.
- Git actions from the commit menu: checkout, branch, merge, rebase, cherry-pick, revert, reset,
  tag, stash actions, squash and drop; drag one branch chip onto another to merge, rebase or
  fast-forward.
- Branch cleanup: scan local branches by age, see which are merged or lost their remote, delete a
  batch in one pass — every result reports the hash needed to undo it.
- Fetch, pull, push and force-push with confirmation; conflict banner with continue/abort/skip.
- Find with Ctrl+F, several repositories in one workspace, view opens in the Panel, the Side Bar
  or an editor tab; repository sidebar with branches, remotes, tags, stashes and submodules.
- Git identity profiles per repository, with suggestions matched to the remote host.
