---
'@parlajs/compiler': minor
---

feat!: a select's params are typed per branch, so `{context, select, part_one {Part one} other {Part {part}}}` takes `{ context: 'part_one' }` alone

A message's params type is then a union: narrow it on the selector before reading a branch's params.
A translation whose branch needs a param its source branch does not is a `param-mismatch` error.
