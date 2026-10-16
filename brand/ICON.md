# Snail Derby brand icon

The mark is the **Finish-line Snail**: a bold flat snail whose eye-stalked head
is crossing a chequered finish line, wearing a yellow racing roundel on its
shell. Flat fills only, no text, no gradients.

## Colours

| Name   | Hex       | Use                          |
| ------ | --------- | ---------------------------- |
| Cream  | `#FFFEEA` | snail / ground               |
| Black  | `#000000` | tile / snail / finish line   |
| Yellow | `#FFEE6F` | racing roundel on the shell  |

## Files

- `icon.svg` — source app icon, 1024×1024 (black tile, cream snail)
- `icon.png` — rendered app icon, 1024×1024 opaque PNG (what `dapp.json` points at)
- `featured-light.svg` / `featured-light.png` — 1920×1080, cream ground, black snail
- `featured-dark.svg` / `featured-dark.png` — 1920×1080, black ground, cream snail

The roundel carries no digit on purpose: the brand framework asks for no text
or numbers in the mark.

## Re-rendering the PNGs

Render each SVG at its native size with headless Chromium (no npm dependency
needed; adjust the binary path to your Playwright cache):

```sh
HS=~/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell
"$HS" --headless --no-sandbox --disable-gpu \
  --screenshot=brand/icon.png --window-size=1024,1024 \
  --default-background-color=000000FF brand/icon.svg
"$HS" --headless --no-sandbox --disable-gpu \
  --screenshot=brand/featured-light.png --window-size=1920,1080 \
  --default-background-color=000000FF brand/featured-light.svg
"$HS" --headless --no-sandbox --disable-gpu \
  --screenshot=brand/featured-dark.png --window-size=1920,1080 \
  --default-background-color=000000FF brand/featured-dark.svg
```

`test/brand-icon.test.js` checks the PNG dimensions, the 256 KB cap on
`icon.png`, and that the SVGs stay on-palette and flat.
