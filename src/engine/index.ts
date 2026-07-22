// Public surface of the Pager pagination engine (Milestone 1).
export { Paginator, createPaginator } from "./paginator.js";
export { measureInFlow, pageAtX } from "./measure.js";
export type { FlowRect } from "./measure.js";
export { captureAnchor, pageForAnchor, pathToElement, elementAtPath } from "./anchor.js";
export {
  PROTOCOL_VERSION,
  isPagerMessage,
  createTransport,
} from "./messages.js";
export type {
  PagerMessage,
  EngineToChrome,
  ChromeToEngine,
  CommandMessage,
  StateMessage,
  AnchorMessage,
} from "./messages.js";
export type { Anchor, PageState, PaginatorOptions } from "./types.js";
