// The dev fixture corpus (public/fixtures/*.html) — a single source of truth
// shared by the app chrome's dev document list and the test suite. In the real
// app the document list comes from the OS (recent files / File > Open); these
// stand in until that native piece lands.
export const FIXTURES = [
  "prose",
  "breaks",
  "tall-media",
  "fixed-sticky",
  "scroll-shell",
  "scroll-shell-nested",
  "sticky-midflow",
  "tables-code",
  "gdocs-export",
  "links",
] as const;
