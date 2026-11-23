# App Store releases (Memories, Cinema)

Team `DA596D32QB`, API key `MFCGJ8UX92` (issuer `f8b76e45-dfdd-4938-916a-f2840dde0f09`,
`.p8` in `~/.appstoreconnect/private_keys/`). Each app's `store/` holds the listing, review
notes, privacy answers, screenshots and `store.json`.

| App | Store folder | Bundle id |
|---|---|---|
| Memories | `apps/memories/ios/store` | `it.davideghiotto.memories` |
| Cinema | `apps/cinema/apps/ios/store` | `it.davideghiotto.cinema` |

## Once, by hand (the API cannot)

1. App Store Connect, Apps, **+**, New App: iOS, name from `listing/name.txt` (fallbacks listed),
   English (U.S.), the bundle id, SKU from `store.json`.
2. App Privacy questionnaire from `privacy/app-privacy-answers.md`.
3. `review/demo-credentials.md` from the `.example` (gitignored).

## Build (bump the build number first: never reused)

```sh
# Memories: CURRENT_PROJECT_VERSION in project.yml, then
cd apps/memories/ios && xcodegen generate
xcodebuild -project Memories.xcodeproj -scheme Memories -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/Memories.xcarchive \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=DA596D32QB archive
xcodebuild -exportArchive -archivePath build/Memories.xcarchive \
  -exportOptionsPlist store/ExportOptions.plist -exportPath build/export -allowProvisioningUpdates

# Cinema: CURRENT_PROJECT_VERSION of target "Swiftfin iOS", then
cd apps/cinema/apps/ios/Swiftfin
xcodebuild -project Swiftfin.xcodeproj -scheme Swiftfin -configuration Release \
  -destination 'generic/platform=iOS' -archivePath ../build/Cinema.xcarchive \
  -skipMacroValidation -skipPackagePluginValidation -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=DA596D32QB archive
xcodebuild -exportArchive -archivePath ../build/Cinema.xcarchive \
  -exportOptionsPlist ../store/ExportOptions.plist -exportPath ../build/export -allowProvisioningUpdates
```

`DEVELOPMENT_TEAM` on the command line is required for Cinema too: the archive ignores
`XcodeConfig/DevelopmentTeam.xcconfig`. The archive is Development-signed; the export re-signs
with the cloud-managed Apple Distribution certificate. Check:
`codesign -dv` shows `Apple Distribution`, entitlements have `get-task-allow` false.

## Upload and submit

```sh
xcrun altool --upload-app -f <ipa> -t ios --apiKey MFCGJ8UX92 \
  --apiIssuer f8b76e45-dfdd-4938-916a-f2840dde0f09
PY="uv run tools/asc/asc.py --store apps/memories/ios/store"
$PY metadata && $PY age-rating && $PY pricing
$PY review --first Davide --last Ghiotto --phone +39... --email ...
$PY screenshots APP_IPHONE_67 screenshots/6.9        # Cinema also: APP_IPAD_PRO_3GEN_129
$PY build <build number> --wait 30 && $PY submit
```

Memories screenshots come from mock mode (`-mock` plus the launch arguments in
`apps/memories/ios/README.md`) on the iPhone 17 Pro Max simulator, status bar overridden to 9:41.
