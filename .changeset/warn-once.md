---
'@parlajs/compiler': patch
---

fix: `parla` and the Vite plugin report each problem once: keys share a line, a rebuild or another environment repeats nothing, and a locale with a parent (a fallback or its base) leaves its gaps to it
