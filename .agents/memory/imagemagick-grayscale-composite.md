---
name: ImageMagick solid-color canvas turns grayscale
description: xc: canvases with equal R=G=B (e.g. white/black) can be encoded as grayscale PNGs, silently desaturating anything composited onto them.
---

`magick -size WxH xc:white canvas.png` (or any xc: color with R=G=B) can produce a
single-channel grayscale PNG instead of sRGB. Compositing a full-color image onto
it (`-composite`) then desaturates the result to black-and-white with no error or
warning — `identify` on the output will show `Grayscale Gray` instead of `sRGB`.

**Why:** ImageMagick picks the most compact encoding for xc: fills; a neutral
color has no chroma info to preserve, so it defaults to grayscale storage.

**How to apply:** When building a solid-color canvas to composite brand/logo
assets onto, force `-colorspace sRGB` on the canvas (and re-assert it on the
final output) before compositing, e.g.
`magick -size 1600x1600 xc:white -colorspace sRGB canvas.png`. Verify with
`magick identify` that the result says `sRGB`, not `Grayscale`.
