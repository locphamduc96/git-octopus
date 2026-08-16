# Third-party notices

Git Octopus ships the following third-party components inside the packaged extension. Each is
redistributed under its own licence, reproduced below. Git Octopus itself is MIT licensed — see
[LICENSE](LICENSE).

---

## @vscode/codicons 0.0.36

The icon font `media/webview/webview.ttf` is the Codicons icon font, redistributed unmodified.

- Copyright (c) Microsoft Corporation
- Source: https://github.com/microsoft/vscode-codicons
- Icons licensed under Creative Commons Attribution 4.0 International (CC BY 4.0):
  https://creativecommons.org/licenses/by/4.0/
- Accompanying source code licensed under the MIT License (reproduced below)

Changes: none. The font file is redistributed as published, without modification to the glyphs or
the font itself.

### MIT License (Codicons source code)

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

---

## Svelte 5

The Svelte runtime is compiled into `media/webview/webview.js`.

- Source: https://github.com/sveltejs/svelte
- Licensed under the MIT License

### MIT License

    Copyright (c) 2016-2025 Svelte Contributors
    https://github.com/sveltejs/svelte/graphs/contributors

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

---

## Shiki 4 (shiki, @shikijs/langs, @shikijs/themes, @shikijs/engine-javascript)

Syntax highlighting in the inline diff panel. The core is compiled into
`media/webview/webview.js`; the grammars and the `dark-plus` / `light-plus` themes ship as the
lazy-loaded files under `media/webview/chunks/`.

- Source: https://github.com/shikijs/shiki
- Licensed under the MIT License (reproduced below)
- The bundled TextMate grammars and themes are collected by Shiki from their upstream projects
  (among them microsoft/vscode for the Dark+/Light+ themes and several first-party grammars) and
  remain under their upstream licences; see
  https://github.com/shikijs/textmate-grammars-themes for the per-grammar provenance.

### MIT License (Shiki)

    Copyright (c) 2021 Pine Wu
    Copyright (c) 2023 Anthony Fu <https://github.com/antfu>

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
