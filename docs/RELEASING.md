# Releasing PageTML (macOS)

How to cut a signed, notarized macOS release and publish it on GitHub. Direct
GitHub distribution (not the Mac App Store), so the artifact is Developer
ID-signed and **notarized** — without notarization, Gatekeeper blocks a
downloaded `.dmg` with "PageTML is damaged and can't be opened."

Releases are cut **manually** for now: the org's GitHub Actions is disabled
(billing), so there is no CI build/sign/publish pipeline yet. Everything below
runs on a Mac with the signing toolchain.

## One-time setup

You need an [Apple Developer Program](https://developer.apple.com/programs/)
membership ($99/yr) and:

1. A **Developer ID Application** certificate in your **login keychain**
   (Xcode ▸ Settings ▸ Accounts ▸ Manage Certificates ▸ + ▸ Developer ID
   Application, or download it from the Developer portal and double-click).
   Confirm it's there:

   ```bash
   security find-identity -v -p codesigning | grep "Developer ID Application"
   ```

2. **Notarization credentials.** Either an App Store Connect API key (preferred)
   or an Apple ID app-specific password. Exact env-var names are in
   [`src-tauri/NOTES.md`](../src-tauri/NOTES.md) under *macOS signing &
   notarization*.

## Cutting a release

1. **Bump the version** in all three source files (keep them in sync):
   - `package.json` → `"version"`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version`

   `src-tauri/Cargo.lock`'s `pagetml` entry updates automatically on the next
   `cargo`/`tauri build` — commit that change too.

   Commit on a branch, open a PR, merge. Tag the merge commit `v<version>`.

2. **Export the signing environment** (see `src-tauri/NOTES.md`), e.g.:

   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
   # + the notarization key/password vars
   ```

3. **Build, sign, notarize, and verify** in one step:

   ```bash
   npm run build:release
   ```

   This runs `tauri build` (which signs and submits for notarization), then
   verifies the result — valid signature, hardened runtime, entitlements,
   Gatekeeper acceptance, and a stapled notarization ticket. It prints
   `RELEASE OK` only if all pass. If it fails, fix the signing setup before
   publishing — do not ship an unverified build.

   Artifacts land in:

   ```
   src-tauri/target/release/bundle/dmg/PageTML_<version>_aarch64.dmg
   src-tauri/target/release/bundle/macos/PageTML.app
   ```

4. **Sanity-check the manual items** a headless build can't (see the QA pass,
   QE-1458): open a real `.html`, drag-drop, two-finger swipe, presentation on
   an external display + disconnect, notch.

5. **Publish the GitHub release** with the `.dmg` attached:

   ```bash
   gh release create v<version> \
     "src-tauri/target/release/bundle/dmg/PageTML_<version>_aarch64.dmg" \
     --title "PageTML v<version>" \
     --notes "…what changed…"
   ```

   Or draft it in the GitHub UI and upload the `.dmg`.

   Source the release body from the `CHANGELOG.md` section for this version, and
   lead with the requirements line — *macOS 12+, Apple Silicon*. Intel Macs
   cannot run the build, so saying so first saves a wave of failed launches.

6. **Verify the way a stranger would.** In a private browsing window, logged out
   of GitHub: does the release page load, and does the `.dmg` actually download?
   Then, ideally on a Mac you have never built on, mount it and open the app —
   **no Gatekeeper warning** is the pass condition. If you see "damaged and can't
   be opened," notarization did not take; fix it before anyone else downloads.

## Before the first public release

One-time work, not per-release. Step 6 above assumes the repo is already public;
these are what gets it there.

1. **Fill every placeholder.** All four user-facing docs carry them:

   ```bash
   grep -rn '⚠️' README.md SECURITY.md LICENSE.md CHANGELOG.md
   ```

   `LICENSE.md` needs the registered legal entity and a governing-law clause,
   `SECURITY.md` a real contact address, `README.md` a support email and a
   screenshot, `CHANGELOG.md` the release date.

2. **Audit the git history for secrets.** Making a repo public exposes every
   commit on every branch, not just `main`, and rewriting history afterwards does
   not recall forks, clones, or archive services. Check that no credential file
   was ever committed:

   ```bash
   git log --all --pretty=format: --name-only --diff-filter=A | sort -u \
     | grep -iE '\.(env|pem|key|p8|p12|cer|mobileprovision)$|secret|credential'
   ```

   Empty output is the pass condition.

3. **Tidy the repo settings** — default branch, description, and topics — and
   delete merged branches, so the public landing page reflects the current state.

4. **Flip visibility**, then run step 6's logged-out download check.

## Notes

- **arm64 only** for now. A universal build (Intel + Apple Silicon) additionally
  needs `rustup target add x86_64-apple-darwin` and
  `tauri build --target universal-apple-darwin`; wire that into `build-release.sh`
  when Intel support is needed.
- **Auto-update** (Tauri updater pointing at GitHub Releases) is not set up yet —
  each release is a fresh download. It can be added later without changing the
  release flow above.
- **Windows** packaging is a separate track (the M5 issues) and not covered here.
