# Third-party notices

`hooks/vendor/mermaid-text.js` is built from [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) 1.1.3 by `scripts/build-vendor.mjs`.

```
MIT License

Copyright (c) 2026 Craft Docs

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
```

`hooks/vendor/prism.js` is built from [Prism](https://github.com/PrismJS/prism) 1.30.0 (core and 24 language definitions) by `scripts/build-vendor.mjs`.

```
MIT LICENSE

Copyright (c) 2012 Lea Verou

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Optional system clipboard tools

On Linux, HTML copying calls an installed and running [CopyQ](https://github.com/hluk/CopyQ) (GPL-3.0-or-later).
CopyQ is supplied by the user's system and is not bundled with merman.

## Color palettes

Each preset in `hooks/presets.ts` maps a published palette onto merman tokens. All are MIT licensed.

| Preset | Source | Copyright |
| --- | --- | --- |
| `catppuccin-mocha`, `catppuccin-latte` | [catppuccin/palette](https://github.com/catppuccin/palette) | Copyright (c) 2021 Catppuccin |
| `dracula` | [dracula/dracula-theme](https://github.com/dracula/dracula-theme) | Copyright (c) 2023 Dracula Theme |
| `nord` | [nordtheme/nord](https://github.com/nordtheme/nord) | Copyright (c) 2016-present Sven Greb |
| `tokyo-night` | [tokyo-night/tokyo-night-vscode-theme](https://github.com/tokyo-night/tokyo-night-vscode-theme) | Copyright (c) 2018-present Enkia |
| `gruvbox-dark`, `gruvbox-light` | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | Pavel Pertsev, MIT/X11 as stated in its README |
| `rose-pine`, `rose-pine-dawn` | [rose-pine/rose-pine-palette](https://github.com/rose-pine/rose-pine-palette) | Copyright (c) mvllow |
| `everforest` | [sainnhe/everforest](https://github.com/sainnhe/everforest) | Copyright (c) 2019 sainnhe |
| `github-dark`, `github-light` | [primer/primitives](https://github.com/primer/primitives) 7.10.0 via [primer/github-vscode-theme](https://github.com/primer/github-vscode-theme) | Copyright (c) 2018 GitHub Inc. |
| `one-dark` | [atom/one-dark-syntax](https://github.com/atom/one-dark-syntax) | Copyright (c) 2016 GitHub Inc. |
| `solarized-dark`, `solarized-light` | [altercation/solarized](https://github.com/altercation/solarized) | Copyright (c) 2011 Ethan Schoonover |
| `neon` | [wverri/neon-hud](https://github.com/wverri/neon-hud) | Copyright (c) 2026 wverri |
