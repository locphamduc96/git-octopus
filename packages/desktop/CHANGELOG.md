# Changelog

## 0.5.0

- **Branches panel** from Git Octopus 0.28.0, on by default in the app.
- **Welcome page** when no tab is open: Open Repository…, the recent list (entries can be removed,
  missing folders are shown struck out) and a folder dropped on the window opens it.
- **The repository is watched**: edits, commits and checkouts made outside the app show up without ⌘R.
- **Git asks for credentials inside the app**: usernames, passwords and host-key questions come up as a
  dialog in the window; nothing is written to the log.
- **Settings → General → Desktop**: Theme (System, Light, Dark), Git path, External editor (Automatic,
  VS Code, Cursor, Zed, Sublime Text or a custom command) and Terminal app (Terminal, iTerm, Ghostty,
  Warp).
- **Open File and conflicted files open in your editor**; without one, in the default app with a note.
- **AI Explain opens in a Markdown panel** with Copy and Save as….

## 0.4.0

- The look from Git Octopus 0.27.0: areas told apart by tone instead of lines, button groups on soft
  islands, a soft column header and softer lists in Settings and the editors.

## 0.3.0

- The refreshed look from Git Octopus 0.26.0: theme tokens, softer corners, quieter graph rows,
  the Working tree panel, compact commit details, themed Settings controls and one footer order for
  every dialog.

## 0.2.0

- **Tabs**, one repository each, across the top of the window — the strip is also the title bar
  the window is dragged by. Each tab names its repository and branch and counts its changes; the
  one in front is marked.
- ⌘T or + opens a folder in a new tab, ⌘W closes the tab, ⌘1–⌘9 and ⌃Tab / ⌃⇧Tab move between
  them; drag a tab to reorder, middle-click to close.
- A tab in the background keeps its view as it was — scroll, selection, open dialogs — and stops
  refreshing until it is in front again.
- The tabs open at quit come back on the next launch, in their order, with the same one in front;
  a worktree opened from the view, or a folder dropped on the Dock icon, opens as a tab.

## 0.1.0

First build of the desktop app for macOS (Apple Silicon), from the same source as the extension.

- A window per folder, with the graph, details, diffs, the commit box and every graph action the
  extension has.
- macOS menu bar: Open Folder… ⌘O, Open Recent, Settings… ⌘,, Refresh ⌘R, Fetch ⌘L, New Branch… ⌘B.
- Light and dark, following macOS; notices and progress drawn inside the window; the change count
  on the Dock icon; the window title names the repository and branch.
- Started from Finder or Spotlight, PATH comes from a login shell, so Homebrew's git and agent CLIs
  are found.
- Packed as `Git Octopus.app` (ad-hoc signed), a .dmg and a .zip; `pnpm desktop:install` copies it
  into /Applications.
