# Security

PageTML opens untrusted HTML files, so its security model matters more than most
readers'. If you find a way around it, please tell us.

## Reporting a vulnerability

Email ⚠️ `security@example.com` *(replace with a real address)*. Please do not
open a public issue for a vulnerability.

Include what you did, what happened, and the document that triggered it if
there is one. Expect an acknowledgement within a few days. Please give us a
reasonable window to ship a fix before disclosing publicly.

## The security model

An opened document is treated as **untrusted content**:

- It is served over a custom `pagetml://` protocol with a path-traversal guard —
  a document cannot reach files outside its own folder.
- It runs in a sandboxed frame with a restrictive CSP, and cannot call into the
  application or read the app's own state.
- Its network access is **denied by default**. The per-file **Remote** toggle is
  the only thing that relaxes this, it is off by default, and it applies to that
  one file.
- Scripts inside the document do run — PageTML renders pages as a browser would,
  including their JavaScript — but only within the sandbox above.

PageTML itself makes no network requests, and collects no analytics, telemetry,
or crash reports.

## In scope

Anything that lets a document escape the sandbox: reading files outside its
folder, reaching the network with **Remote** off, executing code in the trusted
app context, or reading another document's stored state or position.

## Out of scope

- A malformed document rendering badly, paginating oddly, or hanging the app.
  PageTML deliberately renders broken HTML the way a browser does.
- A document reaching the network *after you turn **Remote** on for it* — that is
  the toggle working as designed.

## Supported versions

Only the latest release receives security fixes.
