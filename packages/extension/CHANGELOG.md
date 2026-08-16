# Changelog

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
