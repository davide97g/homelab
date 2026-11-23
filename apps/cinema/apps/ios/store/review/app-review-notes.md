# Notes for App Review

Paste into the "Notes" field of the submission (asc.py review does it).

## What this app is

A client for Jellyfin, the free open-source self-hosted media server, in the same category as the Jellyfin, Swiftfin, Infuse and Plex clients already on the App Store. The user runs the server and their own media lives on it; this app plays it. The app provides no content and talks only to the server the user connects to.

## Signing in

1. On the first screen tap **Connect to server** and enter **https://cinema.davideghiotto.it/jf**
2. On the sign-in screen, skip the "Homelab Account" section at the top and use the user name and password fields below it, with the credentials in the "Sign-in required" fields of this submission.

The demo account sees one library of open movies from the Blender Foundation (Big Buck Bunny, Sintel, Tears of Steel, Elephants Dream, Spring), licensed Creative Commons Attribution, so playback, subtitles and downloads can all be tried.

The "Homelab Account" email code is for the developer's household and sends the code to a real mailbox, so it cannot be used for review.

## Permissions

- Local Network: to reach the user's server at home and discover Cast devices.
- Bluetooth and Microphone: used only by the Google Cast SDK to find nearby Cast devices; iOS asks only when casting.
- Location (when in use): to read the current Wi-Fi network name so the app can prefer the server's home address.
- Face ID: optional lock for local user profiles.

## Licence

Based on Swiftfin (Jellyfin project), Mozilla Public License 2.0, which permits App Store distribution. Source is public at https://github.com/davide97g/homelab/tree/main/apps/cinema/apps/ios
