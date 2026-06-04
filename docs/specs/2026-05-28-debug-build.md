# Debug Build Co-installation Spec

> **Status:** Implemented (#15) · **Created:** 2026-05-28
> **Point-in-time snapshot** of the plan as written; current behavior may have moved on. See the [spec index](./README.md).

## Overview

The debug build (produced by `npm run android`) and the release APK (distributed via GitHub Releases) can coexist on the same device as two separate apps. This allows the developer to use the release APK as a daily driver while freely installing and uninstalling debug builds during development.

---

## Design Decisions

| Decision                    | Choice                                            | Rationale                                                |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Separation mechanism        | `applicationIdSuffix ".debug"` in debug buildType | Standard Android approach; zero runtime overhead         |
| Debug package ID            | `com.yunto.app.debug`                             | Release stays `com.yunto.app`; no impact on distribution |
| Debug app label             | `"Yunto Dev"` via `resValue`                      | Distinguishes the two icons on the home screen           |
| `app_name` in `strings.xml` | Removed; defined per buildType via `resValue`     | Avoids duplicate-resource Gradle error                   |
| Data sharing                | None — each package ID has its own sandbox        | Keeps test/dev sessions separate from real data          |
| Release build               | Unchanged                                         | No impact on CI pipeline or APK distribution             |

---

## Files Changed

### `android/app/build.gradle`

`buildTypes.debug` gets two new lines:

```gradle
debug {
    signingConfig signingConfigs.debug
    applicationIdSuffix ".debug"
    resValue "string", "app_name", "Yunto Dev"
}
```

`buildTypes.release` gets the matching label so `strings.xml` can be emptied:

```gradle
release {
    resValue "string", "app_name", "Yunto"
    ...
}
```

### `android/app/src/main/res/values/strings.xml`

`app_name` removed (now owned by each buildType via `resValue`):

```xml
<resources>
</resources>
```

---

## Developer Workflow

1. Install the release APK from GitHub Releases as the everyday app.
2. Run `npm run android` during development — installs `com.yunto.app.debug` alongside the release app.
3. Uninstall `Yunto Dev` when development is done; the release app is unaffected.

---

## Verification

1. Install the release APK on device.
2. Run `npm run android` — confirm it installs without replacing the release app.
3. Confirm two icons appear: **Yunto** and **Yunto Dev**.
4. Confirm sessions created in one app are invisible to the other.
