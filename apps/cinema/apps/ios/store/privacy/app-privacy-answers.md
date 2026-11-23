# App Privacy answers

For App Store Connect, App Privacy (web UI only). These rows must match `Swiftfin/Swiftfin/Resources/PrivacyInfo.xcprivacy`.

| Data type | Linked to identity | Used for tracking | Purpose |
| --- | --- | --- | --- |
| Contact Info, Email Address | Yes | No | App Functionality |

The email is the homelab account sign-in (accounts.davideghiotto.it). Watch history and playback position live on the user's Jellyfin server; for the demo server the developer runs it, but Apple counts content a user's own server holds as not collected by the developer, and the demo account is the developer's own.

Not collected: Location (read on device for the Wi-Fi name, never sent), Health, Financial, Contacts, Photos, Browsing/Search History, Identifiers, Usage Data, Diagnostics, Purchases.

Required-reason APIs in the manifest: UserDefaults (CA92.1), File timestamp (C617.1), Disk space (E174.1). Dependencies (Nuke, Pulse, Google Cast, Libmpv, ...) carry their own manifests.
