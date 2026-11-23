# Fonts the exam PDF embeds

The report export (docs/adr/0002) compiles the PDF with the house fonts, built into the app so it needs no network and no system font:

- Instrument Sans: static instances (Regular, Medium, SemiBold, Bold and their italics, width 100) cut from the variable font in google/fonts `ofl/instrumentsans` with `fonttools varLib.instancer`. Licence: `InstrumentSans-OFL.txt`.
- JetBrains Mono 2.304: Regular, Bold and Italic from the official release. Licence: `JetBrainsMono-OFL.txt`.

Both are under the SIL Open Font License 1.1.
