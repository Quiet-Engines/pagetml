// Shared DOM predicates used by both the engine and its test harness, so
// "what counts as an atomic piece of content" has a single definition instead
// of drifting copies (the anchor engine and the invariant checker previously
// disagreed on whether <hr> was content).

const REPLACED_TAGS = new Set([
  "IMG",
  "SVG",
  "VIDEO",
  "CANVAS",
  "IFRAME",
  "AUDIO",
  "OBJECT",
  "EMBED",
  "HR",
]);

/** A replaced / atomic element: it renders as an opaque box with no text to
 *  fragment, so it is a valid leaf to anchor to and to protect from clipping. */
export function isReplacedElement(el: Element): boolean {
  return REPLACED_TAGS.has(el.tagName);
}
