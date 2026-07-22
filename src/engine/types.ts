// Shared types for the pagination engine (PageTML Milestone 1).

/**
 * A content anchor: a stable pointer into the document that survives
 * repagination and restarts. It is a CFI-like path (child-index steps from the
 * flow root down to a target element) plus a character offset into that
 * element's text. Deliberately NOT a page number — page numbers are a function
 * of window size and are not stable (spec §3.2, §4.3).
 */
export interface Anchor {
  /** Child-index path from the flow root to the target element. */
  path: number[];
  /** Character offset into the target element's text content. */
  offset: number;
  /** A short prefix of the target's text, used to sanity-check a resolve. */
  textHint: string;
}

/** A snapshot of pagination state, emitted to the chrome on every change. */
export interface PageState {
  pageCount: number;
  /** 0-indexed current page. */
  currentPage: number;
  locked: boolean;
  /** True when pagination is locked (presentation mode) and content has grown
   *  past the locked boundaries, so the current page is confined/clipped and an
   *  indicator should show (spec §3.4, QE-1442). */
  overflow: boolean;
}

export interface PaginatorOptions {
  /** The window whose document is being paginated (the content frame). */
  win: Window;
  /** Gap between pages, in CSS px. Default 40. */
  gap?: number;
  /** Called whenever page count or current page changes. */
  onChange?: (state: PageState) => void;
  /** Animate page turns with a CSS transition. Default true. */
  animate?: boolean;
}
