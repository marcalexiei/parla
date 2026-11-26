---
'@parlajs/core': patch
---

fix: a namespace first loaded during `setLocale` is loaded for the new locale too, so nothing suspends after the switch
