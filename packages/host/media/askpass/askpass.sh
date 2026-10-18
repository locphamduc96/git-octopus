#!/bin/sh
# Bridge between git/ssh and the Git Octopus host: git calls this with the prompt as its
# argument; the real work happens in askpass-main.cjs running under the host app's own binary
# (the editor or the desktop app), started as node through ELECTRON_RUN_AS_NODE.
ELECTRON_RUN_AS_NODE=1 exec "$GIT_OCTOPUS_ASKPASS_NODE" "$GIT_OCTOPUS_ASKPASS_MAIN" "$@"
