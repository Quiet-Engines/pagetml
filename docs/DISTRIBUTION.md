# Getting PageTML in front of people

How to go from "private repo, no builds" to "anyone can download and run it."

[`RELEASING.md`](RELEASING.md) covers *building* a signed, notarized `.dmg`.
This covers everything around it: where the download lives, what has to exist
before you point strangers at it, and the order to do it in.

---

## The thing that blocks everything else

**A private repo's Releases page is not publicly downloadable.** Release assets
inherit repo visibility — an anonymous visitor gets a 404, not a download. There
is no per-asset public flag, so "private repo, public releases" is not something
GitHub offers.

**Decision (QE-1713): `Quiet-Engines/pagetml` goes public.** One repo holds the
source, the user docs, the releases, and the issue tracker. The website's
existing links — nav, footer, and both Download buttons targeting
`releases/latest` — resolve without any change.

Public ≠ open source. The licence is what restricts reuse, not the repo flag;
see [`../LICENSE.md`](../LICENSE.md).

The alternative, had the repo stayed private, was a second public repo holding
no source. It isn't needed, and the files that would have gone there now live at
the repo root.

---

## Before you can ship anything

These are hard prerequisites, not polish. Nothing downloadable exists until all
four are true.

| | Why it blocks you |
| --- | --- |
| **A Mac with the toolchain** | The build is arm64 macOS-only. There is no CI pipeline — the org's GitHub Actions is off for billing — so releases are cut by hand on a Mac. |
| **Apple Developer Program — $99/yr** | Without a Developer ID certificate and notarization, Gatekeeper tells every downloader *"PageTML is damaged and can't be opened."* Not a warning they can click past. This is the most common way a first launch dies. |
| **`npm run build:release` prints `RELEASE OK`** | It verifies signature, hardened runtime, entitlements, Gatekeeper acceptance, and a stapled ticket. If it doesn't print that, don't publish. |
| **A screenshot or demo GIF** | The repo has no imagery at all. A pagination app is a *visual* claim — on X and Reddit, a post without a demo is a post nobody clicks. |

Also worth knowing before you post: the app is **Apple Silicon only**. Intel Mac
users will download the `.dmg` and it won't run. Say "Apple Silicon" in the
release notes and in every post — it costs you nothing and prevents a wave of
bad first impressions.

---

## Step by step on GitHub

### 1. Fix the default branch on this repo

Right now the default branch of `Quiet-Engines/pagetml` is
`claude/pagetml-linear-issues-j91mec` — a stale feature branch, several commits
behind `main`. Every clone, every PR base, and every file link points at the
wrong tree.

**Settings ▸ General ▸ Default branch ▸ switch to `main`.**

Then delete the merged `claude/*` branches (Branches ▸ the trash icon). There
are a dozen; they're all merged or superseded.

### 2. Fix the repo description

It currently reads *"A paginated HTML reader for Mac and Windows."* Windows
isn't started. Change it to:

> A paginated HTML reader and presenter for macOS.

Shipping a Windows claim you can't honor is the first thing a commenter will
catch.

### 3. Tag the release on this repo

`main` already has version `1.0.0` synced across `package.json`,
`tauri.conf.json`, and `Cargo.toml`. There is no `v1.0.0` tag yet.

```bash
git checkout main && git pull
git tag -a v1.0.0 -m "PageTML 1.0.0"
git push origin v1.0.0
```

Tag the private repo even though the download lives elsewhere — the tag is what
tells you which commit produced a given `.dmg`.

### 4. Build the `.dmg`

Follow [`RELEASING.md`](RELEASING.md) on the Mac. You want:

```
src-tauri/target/release/bundle/dmg/PageTML_1.0.0_aarch64.dmg
```

and `RELEASE OK` on stdout. Then do the manual QA pass `RELEASING.md` step 4
lists — open a real `.html`, drag-drop, two-finger swipe, present on an external
display and disconnect it mid-presentation. A headless build can't check any of
that, and each one is a launch-day bug report if it's broken.

### 5. Make the repo public

Everything a public visitor needs is already at the repo root: `README.md`
(user-facing), `LICENSE.md`, `SECURITY.md`, `CHANGELOG.md`, and
`.github/ISSUE_TEMPLATE/`. Developer documentation lives in
[`development.md`](development.md).

**Before flipping it**, fill in the `⚠️` placeholders — they're greppable:

```bash
grep -rn '⚠️' README.md SECURITY.md
```

Support email, security contact, website URL, and the screenshot. A public repo
whose README has visible TODO markers reads as abandoned.

Then: **Settings ▸ General ▸ Danger Zone ▸ Change visibility ▸ Make public.**

Going public exposes the **entire git history across every branch**, not just
`main`. This history was audited on 2026-08-06 — no `.env`, `.p8`, `.p12`, PEM,
or certificate was ever committed on any branch, and every credential-shaped
string is a documentation placeholder. **Re-run that check if anything has been
committed since**, because rewriting history after publication doesn't recall
forks, clones, or archive services.

While you're in Settings: Issues **on**, Wikis and Projects **off**, and
consider Discussions **on** (a good home for "my document paginates weirdly"
threads that aren't bugs).

### 6. Publish the release

**Releases ▸ Draft a new release.**

- Tag `v1.0.0`, created against that repo's `main`.
- Title: `PageTML 1.0.0`.
- Body: the 1.0.0 section of `CHANGELOG.md`, with the requirements line —
  *macOS 12+, Apple Silicon* — as the very first line.
- Attach `PageTML_1.0.0_aarch64.dmg`.
- Leave **Set as pre-release** unchecked, check **Set as the latest release**.

The README's `[Download](../../releases/latest)` link resolves once this exists.

### 7. Verify it the way a stranger would

Do not skip this. Open a **private browsing window**, logged out of GitHub:

1. Load `https://github.com/Quiet-Engines/pagetml` — does the page render, with
   the screenshot?
2. Click Download — does the `.dmg` actually download while logged out? *(This
   is the check that catches the private-repo trap.)*
3. Load `quiet-engines.com/pagetml` and click both Download buttons — those have
   been 404ing since 25 Jul (QE-1556) and this is what fixes them.
3. Ideally on a second Mac you've never built on: mount it, drag to
   Applications, open. **No Gatekeeper warning** is the pass condition. If you
   see "damaged and can't be opened," notarization didn't take — fix it before
   anyone else downloads.

---

## Before you post

- [ ] Logged-out download verified end to end (step 7)
- [ ] Screenshot or GIF in the README — ideally a page turn and presentation mode
- [ ] Brand assets pulled in. There are logo directions sitting unmerged on
      `claude/typeface-logo-design-xwldkk` (`public/brand/`) — pick one, merge
      it, and use it as the repo's social preview image
      (**Settings ▸ Social preview**), which is what X and Reddit render as the
      link card
- [ ] Support and security emails filled in (the ⚠️ markers)
- [ ] Website page live, linking to the GitHub release as the download
- [ ] "Apple Silicon, macOS 12+" stated in the README, the release notes, and
      every post
- [ ] You have an hour free after posting. On Reddit and HN the first hour of
      replies decides the thread

## Posting

Lead with the demo, not the description — this is a visual product.

**Reddit.** r/macapps is the natural home and is friendly to a free app.
r/apple and r/webdev are bigger and much stricter about self-promotion; read
each sub's rules first, and post to one at a time rather than blasting all
three. Say plainly that it's free and source-available, not open source —
"open source" for a proprietary license is the fastest way to lose a thread, and
someone always checks the license file.

**X.** Video or GIF in the first post. The strongest hook is the *idea* rather
than the feature list: browsers can't paginate, so a long HTML doc is an endless
scroll — this makes it a document. The offline-by-default sandbox is a real
differentiator worth its own line.

**Hacker News.** Worth considering as *Show HN*. The engine writeup in this
repo's README — multicol pagination, transform-independent measurement, content
anchors instead of page numbers — is genuinely the most interesting thing you
have for that audience. Bear in mind that HN will ask for the source, and
"source-available, proprietary" is an answer that some of that crowd will push
back on. Have a straight answer ready rather than being surprised by it.

Expect three questions everywhere, so answer them in the README up front:
*Intel Macs?* (no) · *Windows?* (not yet) · *Why not just print to PDF?*
(pagination is live and reflows to the window; PDF is fixed at export time).

---

## After 1.0.0

- **Auto-update.** Not wired up — every release is a manual re-download today.
  Tauri's updater points at a GitHub release feed and can be added without
  changing the release flow.
- **CI.** GitHub Actions is off for billing, so nothing gates `main` and every
  build is by hand. Turning it back on gets you the cross-engine invariant suite
  on every PR, which is the main safety net this project has.
- **Intel / universal builds.** `rustup target add x86_64-apple-darwin` plus
  `--target universal-apple-darwin`; see the note in `RELEASING.md`.
- **Windows.** A separate track (the M5 issues), and the reason the description
  used to say "Mac and Windows."
