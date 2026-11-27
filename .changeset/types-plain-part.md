---
'@parlajs/compiler': minor
---

feat!: only messages with markup take `Node`, so passing a wider `t` to a child costs ~10× fewer type instantiations

Plain messages are in `XText`, and `XMessages<Node> extends XText` adds those with markup. A
namespace without markup is a plain `XMessages`: drop its type argument.
