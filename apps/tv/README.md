# JARVIS on the TV

A launcher on the living-room TV that answers questions about this homelab out loud,
and pulses the set's own Ambilight while it speaks.

```
 iPhone  ──HTTPS──▶  Cloudflare Access ──tunnel──▶  mini PC :8787
 hold to talk                                        jarvis-server
                                                      │   │
                                            OpenAI ◀──┘   │ WebSocket (LAN)
                                          STT + chat      ▼
                                                    Philips 65PUS8505
                                                    jarvis-tv launcher
                                                    TTS + Ambilight
```

Two pieces:

- [`jarvis-tv/`](jarvis-tv/) — the Android TV launcher. Kotlin, plain Views, ~3.5 MB.
- [`jarvis-server/`](jarvis-server/) — Node on the mini PC. Serves the phone webapp,
  transcribes, asks OpenAI, pushes the answer to the TV.

## The TV

Philips **65PUS8505/12**, board TPM191E, at `192.168.15.106`.

| | |
|---|---|
| SoC | MediaTek **MT5887**, 4× Cortex-A53, 2 GB RAM |
| OS | **Android 12** (SDK 31), build `STT2.230526.001`, patch 2025-11-01 |
| Philips firmware | `TPM191E_R.211.000.103.000` — the Android 12 branch, Dec 2025 |
| ABI | **armeabi-v7a** — 32-bit userspace on a 64-bit kernel |
| Panel | 3840×2160, Android surface forced to 1920×1080 |
| Ambilight | 3-sided: left 4, top 9, right 4, bottom 0 |

### There is no root, and there will not be

`ro.boot.vbmeta.device_state=locked`, `verifiedbootstate=green`, verity enforcing,
`ro.secure=1`, `ro.debuggable=0`, and `oem_unlock_allowed` is unset — the toggle is
not exposed in Developer options at all. The shell user cannot read
`/dev/block/by-name/boot_b`, so there is no image to patch. A/B OTA covers `uboot`,
`uboot_env`, `tzbp` and `vbmeta`, so the bootloader is vendor-signed and updated.

The one public attempt on this board (Magisk issue #8160) never got `su` to appear
even on Android 9 and 11, and tripped over the same 32-bit ABI. Nothing has been
published for the 211.x branch. This is a closed device; everything below works
*without* root and is fully reversible.

### The parts that are wide open

**Ambilight needs no credentials.** JointSpace on **port 1925 (plain HTTP)** accepts
writes under `/6/ambilight` unauthenticated, including from the TV to itself on
`127.0.0.1`. Port 1926 (HTTPS) does require digest pairing, but nothing we need lives
only there.

```sh
TV=192.168.15.106
curl -X POST -d '{"current":"manual"}'        http://$TV:1925/6/ambilight/mode
curl -X POST -d '{"r":0,"g":90,"b":255}'      http://$TV:1925/6/ambilight/cached
curl -X POST -d '{"current":"internal"}'      http://$TV:1925/6/ambilight/mode   # give it back
```

`/6/system` is readable too, but its interesting fields are encrypted. They are
AES-128-CBC, IV = the first 16 bytes, key = the first 16 bytes of the base64-decoded
`AUTH_SHARED_KEY` that ships in every Philips client library:

```sh
curl -s http://$TV:1925/6/system   # model, serial, softwareversion, deviceid
```

### ADB

Developer options → USB debugging + network debugging. **This resets on reboot**, so
after a power cycle it has to be re-enabled by hand before anything here can be
installed.

```sh
adb connect 192.168.15.106:5555      # then accept the RSA prompt on the TV
```

## Building and installing the launcher

One script does everything: build, connect over ADB, install.

```sh
scripts/deploy-tv.sh              # build + install, then launch
scripts/deploy-tv.sh --launcher   # also set JARVIS as the HOME launcher
scripts/deploy-tv.sh --restore    # put the stock Google launcher back
scripts/deploy-tv.sh --no-build   # install the last-built APK, skip the build
```

Override the TV address with `TV=192.168.1.50 scripts/deploy-tv.sh`. First time only,
you need JDK 17 and the Android SDK, which are not on the Mac by default:

```sh
brew install openjdk@17
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"
```

The APK is signed with the debug key on purpose — it is sideloaded onto one TV and
never published.

### It is the launcher

`scripts/deploy-tv.sh --launcher` makes JARVIS the home screen. Google TV pins the HOME
role to its own launcher, so `set-home-activity` alone does not stick; the one method
that works is **disabling the stock launcher** (`pm disable-user`). A disabled app
cannot re-enable itself, so the escape hatch is built into JARVIS instead of relying on
a computer:

**Gear (top-right of the home screen, or the remote's MENU key) → Ripristina launcher
Google.** That opens the stock launcher's app-details page, where a disabled system app
shows an **Attiva** button — one press and Google is back, no computer needed. The same
thing from a terminal is `scripts/deploy-tv.sh --restore`.

Verified round trip: enabling the stock launcher restores it as HOME; disabling it
returns HOME to JARVIS.

### Settings, without rebuilding

```sh
adb shell am start -n it.davideghiotto.jarvistv/.HomeActivity \
    -e server_host debian.fritz.box --ei server_port 8787 --ez ambilight true
```

`server_host` defaults to **`debian.fritz.box`** — the name the Fritz!Box keeps
pointed at the mini PC, so it survives the DHCP lease moving, which has broken
IP-based configs here before. Set it to `mdns` to discover `_jarvis._tcp` instead,
but do not rely on that: `NsdManager` on this set finds the service and then never
fires the resolve callback.

An empty `-e server_host ""` does **not** clear a stored value; use `pm clear`.

## The server

```sh
rsync -a --exclude node_modules --exclude .env jarvis-server/ homelab:~/jarvis-server/
ssh homelab 'cd ~/jarvis-server && docker compose up -d --build'
```

`.env` on the box holds `OPENAI_API_KEY` and the two model names. The compose file
uses `network_mode: host` because the mDNS advert has to reach the LAN and the service
probes have to see the host's own ports, and mounts `/proc` read-only as `/host/proc`
for the CPU, memory and uptime figures.

Service health is a **TCP connect per port**, not the Docker API: the box runs Dokploy
services, plain compose projects in `~/mediarr`, and `cloudflared` as a systemd unit,
and a port probe treats all three alike without mounting a socket into the container.

| route | what it does |
|---|---|
| `GET /` | the phone webapp |
| `POST /api/ask` | `audio` file or `text` field → transcript + answer, pushed to the TV |
| `GET /api/status` | the same snapshot the TV gets |
| `GET /healthz` | for the container healthcheck |
| `POST /api/key` | send one allowlisted JointSpace key (D-pad, volume, playback) |
| `POST /api/playback` `/api/seek` `/api/play` `/api/search` `/api/launch` | phone TV controls |
| `WS /ws` | TV clients; receives `status`, `transcript`, `say`, `launch` |

## The phone

**https://jarvis.davideghiotto.it** — behind Cloudflare Access, allowing
`ghiotto.davidenko@gmail.com`, 720 h sessions so the button stays one tap away.

HTTPS is not a nicety here: **iOS Safari will not expose a microphone on a plain-HTTP
origin**, with no override. The LAN address gives you the page but never the mic, so
the tunnel is the only route that works from a phone.

Set up 2026-09-16: an ingress rule on the `homelab` tunnel → `http://localhost:8787`,
a proxied CNAME, and an Access app mirroring the grafana one.

## Jellyfin: asking for a film and getting one

> *"ok fai partire jellyfin con harry potter"*
> — "È partito Harry Potter e la Pietra Filosofale. Buona visione!" *(and it is playing)*

The model has tools, not just a system prompt: `play_media`, `search_media` and
`control_playback` (pause / resume / stop / next / previous). It calls them for real
and then confirms what happened, rather than telling you to go and press play.

### There are two Jellyfin servers, and only one of them matters

| | mini PC | **NAS** |
|---|---|---|
| where | `streaming.davideghiotto.it` → `:8096` | `jellyfin.davideghiotto.it` → NAS `:8899` |
| libraries | Movies, Shows | Movies, **Shared Movies** |
| version | 10.11.11 | **12.1.0** |
| the TV is signed into it | no | **yes**, as the `root` user |

The TV has never been signed into the mini PC's Jellyfin, so **JARVIS drives the NAS
one**. The box reaches it over Tailscale at `${NAS_TAILNET_IP}:8899`; the Mac has no route
there at all, so anything testing this has to run on the box.

**Jellyfin 12 rejects `X-Emby-Token` with a bare 401.** The only header it accepts is:

```sh
curl -H 'Authorization: MediaBrowser Token="$JELLYFIN_NAS_TOKEN"' \
     http://${NAS_TAILNET_IP}:8899/Sessions
```

The mini PC's 10.11 takes either, so the `MediaBrowser` form is what the code uses
everywhere.

### How playback actually starts

Nothing is deep-linked into the Jellyfin app — it declares `ACTION_VIEW` but no URI
scheme, so there is no intent that says "play this item". Instead the app registers a
**remote-controllable session** on the server, and the server drives it:

```
POST /Sessions/{sessionId}/Playing?playCommand=PlayNow&itemIds={itemId}
```

The session is matched by `DeviceName` (`TV Davide`), never by a stored id — the id
changes every time the app restarts.

When the app is closed there is no session to control, so the server first pushes a
`{"type":"launch","package":"org.jellyfin.androidtv"}` frame down the WebSocket, the
launcher starts the app, and the server polls for up to 25 s until the session appears.
Cold path measured end to end: **5.5 s** from question to picture.

## The phone as a real remote (JointSpace)

Volume, a D-pad, Home/Back and playback keys, all from the phone. None of these are on
the plain-HTTP port 1925 — they live behind **JointSpace pairing on the HTTPS port
1926**, which was done once on 2026-09-16.

### Pairing (already done; here for when the key is lost)

1. `POST https://TV:1926/6/pair/request` with a device block → the TV shows a 4-digit PIN,
   and the response carries an `auth_key` and `timestamp` (60 s window).
2. Sign `str(timestamp) + pin` with HMAC-SHA256 under the shared Philips secret (the same
   one that decrypts `/system`, base64-decoded), and `POST /6/pair/grant`.
3. Store the device `id` and `auth_key`. Every later call uses **HTTP digest auth**,
   username = id, password = auth_key, over the self-signed HTTPS.

Credentials are in `homelab/.env` as `JOINTSPACE_ID` / `JOINTSPACE_KEY`.

```sh
curl -sk --digest -u "$JOINTSPACE_ID:$JOINTSPACE_KEY" \
     -X POST -H 'Content-Type: application/json' -d '{"key":"VolumeUp"}' \
     https://192.168.15.106:1926/6/input/key
```

Node has no digest-over-TLS client, so `src/jointspace.js` does the two-step challenge
by hand and reuses one keep-alive socket — the TV's TLS handshake is slow and drops a
fresh connection per key press.

### Volume goes to the Bose, over ARC

The set's own audio is muted — sound goes to a **Bose Soundbar 500** over HDMI-ARC.
`VolumeUp`/`VolumeDown`/`Mute` sent to the TV are relayed to the soundbar over CEC,
exactly as the TV remote does it. The soundbar itself has **no usable network API**:
it is Bose's Riviera platform, which dropped SoundTouch, and its only open ports are
AirPlay (7000, would hijack audio) and a read-only diagnostic script server (8091).

### Auto power-on with the TV — not code

The soundbar waking and switching to the TV source when the TV turns on is a **CEC /
Philips EasyLink** handshake, not something reachable here: Android reports
`mIsCecAvailable: false` because Philips runs CEC on its Linux side. Fix it in the
menus — TV EasyLink + ARC + auto-power on, and HDMI-CEC / TV-wake in the Bose Music app.

## Known, not yet fixed

- The nine-service row clips its last entry. It needs a two-row flow layout.
- The launcher opens **two** WebSocket connections on start. Harmless — the server
  broadcasts to every TV client — but wrong.
- `renderReply` never clears, so the last answer stays on screen until the next one.
