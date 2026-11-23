# Notes for App Review

Paste into the "Notes" field of the submission (asc.py review does it).

## What this app is

A client for Immich, the open-source self-hosted photo server, in the same category as the Immich, Nextcloud and Synology Photos clients already on the App Store. The user runs the server; their photos live on it; this app browses them and backs up the iPhone's photos to it. It talks only to the server the user signs in to.

## Signing in

1. On the first screen tap **Sign in with a server password**.
2. Server URL: **https://memories.davideghiotto.it/immich**
3. Email and password: the ones in the "Sign-in required" fields of this submission.

The demo account holds a small library of photos we own the rights to, with albums, so every screen has content.

The default "email code" sign-in is for the developer's household account and sends the code to a real mailbox, so please use the server password form above.

Without signing in, **Explore with Sample Library** on the first screen opens a generated sample library on the device (no network), which shows every screen too.

## Permissions

- Photo Library: only to back up the iPhone's photos and videos to the user's own server, and to remove local copies the user chooses to delete once the server has them (Settings, Free Up Space; iOS asks for confirmation).
- Local Network: to reach the server directly at home so large videos do not go over the Internet.

## Data

No analytics, advertising or tracking SDKs. The email address is used only to sign in. Photos go to the user's server and nowhere else.
