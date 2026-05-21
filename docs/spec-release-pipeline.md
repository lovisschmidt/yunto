# Automated Release Pipeline Spec

## Overview

On every merge to `main`, a GitHub Actions workflow builds a signed release APK and
publishes it as a GitHub Release. The release job gates on the existing CI checks
(lint, typecheck, fmt, test) passing first.

---

## Design Decisions

| Decision          | Choice                                   | Rationale                                                     |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------- |
| Trigger           | Push to `main`                           | Every squash-merged PR produces a release                     |
| Version bump      | Dev bumps `package.json` in the PR       | Explicit, conventional; nothing auto-commits to main          |
| versionCode       | `github.run_number`                      | Always incrementing, stored by GitHub, zero maintenance       |
| Duplicate version | Skip release silently                    | Tag exists → log + exit 0; merge still lands cleanly          |
| CI gate           | `needs: check` in same workflow          | Release never ships if lint/type/test fail                    |
| APK type          | Universal FAT APK                        | One file for all devices                                      |
| ABI targets       | `arm64-v8a,armeabi-v7a`                  | Covers all real Android devices; x86/x86_64 are emulator-only |
| ProGuard/R8       | Disabled                                 | Avoids R8-induced runtime crashes from incomplete rules       |
| Changelog         | GitHub auto-generated release notes      | Zero config; reads well given commitlint discipline           |
| Gradle cache      | `~/.gradle/caches` + `~/.gradle/wrapper` | Cuts builds from ~15 min to ~5 min                            |

---

## One-Time Keystore Setup

Run **locally**, never in CI. Keep the keystore file off-disk after uploading to GitHub Secrets.

```bash
keytool -genkeypair \
  -v \
  -keystore release.keystore \
  -alias yunto \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Encode the keystore for GitHub Secrets:

```bash
base64 -i release.keystore | pbcopy   # macOS — copies to clipboard
```

Add these four GitHub Secrets at **Settings → Secrets and variables → Actions**:

| Secret                      | Value                           |
| --------------------------- | ------------------------------- |
| `RELEASE_KEYSTORE`          | base64-encoded `.keystore` file |
| `RELEASE_KEYSTORE_PASSWORD` | keystore password you chose     |
| `RELEASE_KEY_ALIAS`         | key alias (e.g. `yunto`)        |
| `RELEASE_KEY_PASSWORD`      | key password you chose          |

Store the keystore file in a secure location (password manager, etc.). If you lose it,
existing users must uninstall before installing future releases.

---

## Developer Workflow

1. Make changes in a feature branch
2. **Bump `package.json` version** (e.g. `1.0.0` → `1.1.0`) in the same PR if a new release is warranted
3. Squash-merge the PR to `main`
4. CI `check` job runs; if it passes, the `release` job starts automatically
5. If the version was bumped: GitHub Release `v1.1.0` appears with the APK attached
6. If the version was NOT bumped: release job detects the existing tag and skips silently

---

## Files Changed

### `.github/workflows/ci.yml`

Adds a `release` job after the existing `check` job.

- `needs: check` — gates on CI passing
- `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` — only runs on merges to main, not on PRs
- `permissions: contents: write` — required to create tags and releases

Key steps:

1. Read version from `package.json`
2. Check if git tag `v{version}` already exists on origin; skip if it does
3. Set up JDK 17 (temurin)
4. Set up Node 24 (from `.nvmrc`)
5. Restore Gradle cache
6. `npm ci`
7. Decode base64 keystore secret to `$RUNNER_TEMP/release.keystore`
8. `./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a -PversionCode=${{ github.run_number }}`
9. Rename APK to `yunto-v{version}.apk`
10. Create GitHub Release (tag + name = `v{version}`, auto-generated notes, APK attached)

### `android/app/build.gradle`

Three changes:

**1. Read version from `package.json`** (added near top, after `def projectRoot`):

```gradle
def packageJson = new groovy.json.JsonSlurper().parseText(new File("$projectRoot/package.json").text)
```

**2. Use `versionCode` Gradle property (injected by CI) and `versionName` from `package.json`** in `defaultConfig`:

```gradle
versionCode (findProperty('versionCode') ?: 1).toInteger()
versionName packageJson.version
```

CI passes `-PversionCode=${{ github.run_number }}`. Local builds fall back to `1`.

**3. Add release `signingConfig`** (env vars; falls back to debug for local builds):

```gradle
signingConfigs {
    debug { ... }  // unchanged
    release {
        storeFile file(System.getenv("RELEASE_KEYSTORE_PATH") ?: "debug.keystore")
        storePassword System.getenv("RELEASE_KEYSTORE_PASSWORD") ?: "android"
        keyAlias System.getenv("RELEASE_KEY_ALIAS") ?: "androiddebugkey"
        keyPassword System.getenv("RELEASE_KEY_PASSWORD") ?: "android"
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release  // was signingConfigs.debug
        ...
    }
}
```

---

## APK Output Path

`android/app/build/outputs/apk/release/app-release.apk`

---

## Verification

After the secrets are configured and the workflow is merged:

1. **Duplicate-version test**: merge a PR without bumping the version — release job should log "Tag already exists" and exit green (no release created)
2. **Full release test**: bump `package.json` to `1.1.0`, merge PR — GitHub Release `v1.1.0` should appear with `yunto-v1.1.0.apk`
3. **APK install test**: sideload the APK onto an Android device — should install without "package not signed" errors
