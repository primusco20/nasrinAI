# Design sources

`app-icon.svg` is the home-screen icon. The PNGs in `public/` are made from it
(and `favicon.ico` from `public/icon.svg`) by rendering at 1024 px in Chromium
and scaling down:

| File | Size | Used by |
| --- | --- | --- |
| `public/apple-touch-icon.png` | 180 | iPhone and iPad home screen |
| `public/icon-192.png`, `public/icon-512.png` | 192, 512 | Android home screen (`manifest.webmanifest`) |
| `public/favicon.ico` | 16–48, transparent | browsers that do not use `icon.svg` |

`public/icon.svg` is the browser-tab icon: a black ball in light mode, a white
one in dark mode.
