# The exam PDF is Typst, compiled in Rust

Raven writes the exam report PDF by turning the report's pages into one Typst source in TypeScript (`src/engines/report/typst.ts`), then compiling it inside the Rust backend with the `typst` and `typst-pdf` crates and the house fonts bundled in the app. We chose this over printing the page's HTML from a hidden WKWebView because WebKit cannot put page numbers in the margins with CSS, so a numbered contents page needs workarounds, and silent print-to-file needs native Objective-C bridging. Typst gives us real page numbers, a contents page with page numbers, figures kept with their captions, and embedded fonts. It needs no network and makes no new JavaScript dependency.

The cost is a second stylesheet: the PDF's look lives in a Typst template, kept in step with `page.css` by hand. The owner chose that look in the page-style round of 2026-11-23: style A (the house style on paper), on US Letter. The template writes structure only through a few functions (`rv-code`, `rv-figure`, `rv-table`, `rv-enum`, `rv-list`, `rv-number`, `rv-inline-code`), so a later restyle changes the template, not the converter.

Every piece of the owner's text reaches Typst as a string literal, never as markup, so nothing they typed can change the document's structure or read a file.
