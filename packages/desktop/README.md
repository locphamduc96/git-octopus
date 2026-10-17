# Git Octopus — desktop app (macOS)

The Git Octopus graph as an app of its own, built from the same source as the VS Code extension:
`@git-octopus/host` runs git and the services, `@git-octopus/webview` draws the view, and this
package is the shell around them (window, menu, Dock, the host process behind each window).

## Run it

From the repository root:

```sh
pnpm desktop            # build and start, from source
pnpm desktop:dist       # pack Git Octopus.app, a .dmg and a .zip into packages/desktop/release/
pnpm desktop:install    # pack, then copy Git Octopus.app into /Applications
```

Then open it like any app: Spotlight (⌘ Space, "Git Octopus"), Launchpad or Finder → Applications.
It asks for a folder the first time and reopens the folders left open after that.

- **Signing** is ad-hoc: enough for Apple Silicon to run it on the Mac that built it. Copied to
  another Mac, the first launch needs right-click → Open (it is not notarized).
- **PATH**: started from Finder, the Dock or Spotlight, the app reads PATH from a login shell once,
  so Homebrew's git and agent CLIs such as `claude` are found as in a terminal.
- **Data**: settings and state in `~/Library/Application Support/Git Octopus/`, logs in
  `~/Library/Logs/Git Octopus/` (Help → Show Logs).
- **Icon**: rendered from `packages/extension/media/icon.svg` by `pnpm --filter @git-octopus/desktop icon`.

## Tests

`pnpm e2e:desktop` drives the app from source with Playwright. To drive the packed app instead:

```sh
GIT_OCTOPUS_E2E_DESKTOP_APP="$PWD/packages/desktop/release/mac-arm64/Git Octopus.app" \
  pnpm --filter @git-octopus/e2e e2e:desktop
```
