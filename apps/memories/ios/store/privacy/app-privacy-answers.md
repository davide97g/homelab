# App Privacy answers

For App Store Connect, App Privacy (web UI only; the API cannot set it). These rows must match `Memories/Resources/PrivacyInfo.xcprivacy`.

| Data type | Linked to identity | Used for tracking | Purpose |
| --- | --- | --- | --- |
| Contact Info, Email Address | Yes | No | App Functionality |
| User Content, Photos or Videos | Yes | No | App Functionality |

Why both, even though the server is the user's own: the developer also runs the demo server and the accounts.davideghiotto.it sign-in, so for some users the data does reach a server the developer operates. Declaring it is the honest answer and costs nothing.

Not collected: Location, Health, Financial, Contacts, Browsing/Search History, Identifiers, Usage Data, Diagnostics, Purchases. No third-party SDKs (the app has no package dependencies).

Required-reason APIs in the manifest: UserDefaults (CA92.1), File timestamp (C617.1).
