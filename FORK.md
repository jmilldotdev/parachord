# Parachord fork: build, update, contribute

Install from [jmilldotdev/parachord Releases](https://github.com/jmilldotdev/parachord/releases/latest), not the upstream Releases page. Choose the `arm64` DMG for Apple Silicon, the `x64` DMG for Intel, or the `x86_64` AppImage for Linux. Quit and replace any existing upstream copy for the first install: the apps share their name, bundle ID, and user data, but only the fork binary points its updater at the fork.

## Sync and release

- **Fork sync** (`.github/workflows/fork-sync.yml`) runs at 08:23 UTC nightly and on demand. GitHub's fork-sync API merges `Parachord/parachord:main` into `jmilldotdev/parachord:main`, retaining fork commits. A merge conflict opens a fork issue and stops publication. Resolve by merging `upstream/main` into local fork `main`, fixing conflicts, and pushing to `origin main`; rerun Fork sync. No force push or personal access token is used.
- A successful sync dispatches **Fork release** (`.github/workflows/fork-release.yml`), even if already up to date. Dispatch Fork release directly if you just pushed your own changes or added secrets and don't want to wait. Both workflows only act on this fork's `main`. [Actions](https://github.com/jmilldotdev/parachord/actions) must remain enabled; Issues are enabled for conflict reports. GitHub may automatically disable scheduled workflows after 60 days of repository inactivity; re-enable Fork sync from Actions if that happens.
- Fork release builds macOS arm64/x64 DMG and ZIP plus the Linux x64 AppImage. It combines the two Mac ZIP entries in `latest-mac.yml` (the DMGs are manual installers) and also publishes `latest-linux.yml`. The packaged `app-update.yml` targets `jmilldotdev/parachord`. The manifest describes versions, filenames, and checksums; the repository is selected by the packaged config, not the manifest itself.
- The first release (`v0.9.14`) used only the hosted Intel and Linux artifacts because GitHub did not assign the Apple Silicon job a runner. Its `latest-mac.yml` contains just the Intel ZIP. Apple Silicon Macs can use that DMG only if Rosetta is installed. Normal nightly releases still require both Mac architectures.
- Versioning is CI-only: for upstream `MAJOR.MINOR.PATCH`, the fork package and stable GitHub tag use `MAJOR.MINOR.(PATCH + Fork release run number)`. For example, upstream `0.9.13` at release run 1 becomes `v0.9.14`; another run of the same source becomes `v0.9.15`. The increasing run number also distinguishes fork-only changes; ordinary upstream version increases preserve ordering. A job will not promote a version lower than the existing latest release. Reruns keep their run number; dispatch a **new** run to ship another version. The release notes identify the source commit and unmodified upstream package version.
- **Ad-hoc macOS builds** are not notarized. Gatekeeper may block the first launch of a downloaded copy; if you trust the build and want to open it, use macOS System Settings → Privacy & Security → Open Anyway after the first blocked launch. Do not disable Gatekeeper globally. These builds can check the fork feed but **cannot install in-app macOS updates**: download and replace the app manually, including the first Developer ID-signed release. Once installed, consistently Developer ID-signed and notarized builds from the same team can use the in-app updater. Removing signing secrets reverts subsequent builds to manual-only.
- The macOS native MusicKit path does not need a developer token, but depends on the helper's signing and system authorization; do not rely on native playback in an ad-hoc build. Without a MusicKit secret, the build supplies no token for Apple Music API/MusicKit JS features. iTunes Search fallback and non-Apple sources are unaffected. You can separately paste a developer token in Apple Music plug-in Settings. This fork does not use upstream's castLabs EVS account; bundling a developer token does not change production Widevine requirements.
- Fork settings disable upstream **Build**, **Publish Browser Extensions**, **Deploy Smart Links**, **Blog RSS to Announcements**, **Chrome OAuth Keep-Alive**, **Sync to Dedicated Repos**, **Reverse Sync from Dedicated Repos**, **Sync Releases to Discussions**, and **Rerun jobs that never got a runner**. **Test** and **Label PRs** remain enabled. These are fork-side settings, not diffs against upstream workflow files.

## Owner checklist: signing, notarization, MusicKit

1. **Developer ID signing (Account Holder).** On a Mac, open Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority → Saved to disk. In [Apple Developer → Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources), choose Certificates → **+** → **Developer ID Application** → Continue → upload the CSR. Download the `.cer` and import it on the same Mac. In Keychain Access → My Certificates, expand the Developer ID certificate, select it and its private key, then File → Export Items → `.p12`; set a nonempty password. See [Apple's Developer ID instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/).
2. **Notarization (team key).** In [App Store Connect](https://appstoreconnect.apple.com/), open Users and Access → Integrations → App Store Connect API → Team Keys → **+**. Select **Admin**, give it a name, Generate, and download the `.p8` (once). Copy the Key ID and Issuer ID. This key is for notarization, not for replacing the Account Holder's Developer ID certificate. See [Apple's API key instructions](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api).
3. **Put both sets of credentials into the fork's Actions secrets.** Run the commands below locally; the interactive prompts hide the values. Supply all five for signed and notarized builds. Keep the files out of the clone and source control.

   ```sh
   base64 < '/path/to/Developer ID Application.p12' | tr -d '\r\n' | gh secret set CSC_LINK -R jmilldotdev/parachord
   gh secret set CSC_KEY_PASSWORD -R jmilldotdev/parachord
   gh secret set APPLE_API_KEY_ID -R jmilldotdev/parachord
   gh secret set APPLE_API_ISSUER -R jmilldotdev/parachord
   gh secret set APPLE_API_KEY_P8 -R jmilldotdev/parachord < '/path/to/AuthKey_NOTARY_KEY_ID.p8'
   ```

4. **MusicKit (optional, separate Apple key).** In Apple Developer → Certificates, Identifiers & Profiles → Identifiers → **+** → **Media IDs**, register a reverse-DNS identifier with MusicKit enabled. Go to Keys → **+** → Media Services → Configure; associate the Media ID, register, and download the `.p8`. Note its Key ID and the Team ID in Apple Developer → Membership details. The [Apple Media Services instructions](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/) cover the association. The workflow mints a fresh 30-day JWT and includes only the JWT in the distributable app. Alternatively, set `MUSICKIT_DEVELOPER_TOKEN` instead; it takes precedence, ships in the app, and must be renewed before it expires.

   ```sh
   gh secret set MUSICKIT_PRIVATE_KEY -R jmilldotdev/parachord < '/path/to/AuthKey_MUSICKIT_KEY_ID.p8'
   gh secret set MUSICKIT_KEY_ID -R jmilldotdev/parachord
   gh secret set MUSICKIT_TEAM_ID -R jmilldotdev/parachord
   # Or, to ship a pre-issued developer JWT instead of minting in CI:
   gh secret set MUSICKIT_DEVELOPER_TOKEN -R jmilldotdev/parachord
   ```

5. Run [Fork release](https://github.com/jmilldotdev/parachord/actions/workflows/fork-release.yml) on `main`. Confirm the release is labeled Developer ID signed and notarized, then manually install it to switch from an ad-hoc build.

## Make a change and send it upstream

Start feature branches directly from upstream so fork-only workflow commits stay out of the PR:

```sh
git fetch upstream
git switch -c my-fix upstream/main
# Make, commit and check the change per README.md.
git push -u origin my-fix
```

On GitHub, open a PR from `jmilldotdev:my-fix` to `Parachord:main`. If you want to run it before upstream merges it, cherry-pick just your fix onto current fork `main`, push to `origin main`, and run Fork release. Once upstream merges it, nightly sync brings upstream's result into the fork. Resolve any conflict in fork `main` rather than rewriting published history. Do not use fork `main` as the head of an upstream PR.
