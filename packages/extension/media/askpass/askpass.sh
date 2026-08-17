#!/bin/sh
# Bridge between git/ssh and the Git Octopus extension host: git calls this with the prompt as
# its argument; the real work happens in askpass-main.cjs running under the editor's node.
ELECTRON_RUN_AS_NODE=1 exec "$GIT_OCTOPUS_ASKPASS_NODE" "$GIT_OCTOPUS_ASKPASS_MAIN" "$@"
