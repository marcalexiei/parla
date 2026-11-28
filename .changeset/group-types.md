---
'@parlajs/compiler': patch
---

perf: a group with markup splits into plain and markup interfaces too, and markup callbacks share one alias, so a deep walk of a large catalog instantiates ~44% fewer types
