/**
 * Mock of what the launcher will actually have on the TV:
 *  - `img` is the showcase photograph (Unsplash, see assets/backdrops/CREDITS.md).
 *    On the set it is a Jellyfin backdrop, the album art, or a photo from the album;
 *  - apps come from queryIntentActivities(LEANBACK_LAUNCHER)
 *  - `hero` is the showcase behind the rail. On the real set it comes from Jellyfin
 *    (backdrop + resume position), from the now-playing item, or from a photo album;
 *    when an app has none, the palette gradient below is the fallback that ships.
 *  - `palette` doubles as the card face and as the Ambilight colour while focused.
 */
const APPS = [
  {
    id: 'jellyfin', img: 'assets/backdrops/jellyfin.jpg', label: 'Jellyfin', pkg: 'org.jellyfin.androidtv',
    kind: 'film', mark: 'J', palette: ['#1D6BFF', '#6B3BFF', '#0A1030'],
    accent: '#7AA2FF',
    hero: {
      kicker: 'Continua a guardare · Jellyfin',
      title: 'Dune: Parte Due',
      meta: ['2024', '2h 46m', '4K HDR', 'NAS'],
      progress: 0.38, progressText: '1h 42m rimanenti',
      cta: 'Riprendi',
    },
  },
  {
    id: 'spotify', img: 'assets/backdrops/spotify.jpg', label: 'Spotify', pkg: 'com.spotify.tv.android',
    kind: 'music', mark: 'S', palette: ['#1DB954', '#0B3B22', '#05100B'],
    accent: '#3FE07A',
    hero: {
      kicker: 'In riproduzione · Spotify',
      title: 'Random Access Memories',
      meta: ['Daft Punk', '2013', 'Album'],
      progress: 0.61, progressText: 'Instant Crush · 3:12 / 5:37',
      cta: 'Riprendi',
    },
  },
  {
    id: 'photos', img: 'assets/backdrops/photos.jpg', label: 'Ricordi', pkg: 'app.alextran.immich',
    kind: 'photo', mark: 'R', palette: ['#FF8A3D', '#B8377A', '#1A0A14'],
    accent: '#FFB07A',
    hero: {
      kicker: 'Ricordi · un anno fa',
      title: 'Dolomiti, settembre',
      meta: ['128 foto', 'Immich'],
      cta: 'Apri',
    },
  },
  {
    id: 'youtube', img: 'assets/backdrops/youtube.jpg', label: 'YouTube', pkg: 'com.google.android.youtube.tv',
    kind: 'video', mark: 'Y', palette: ['#FF2C2C', '#5A0A0A', '#120405'],
    accent: '#FF6B6B',
    hero: { kicker: 'YouTube', title: 'Guarda dopo', meta: ['23 video'], cta: 'Apri' },
  },
  {
    id: 'twitch', img: 'assets/backdrops/twitch.jpg', label: 'Twitch', pkg: 'tv.twitch.android.app',
    kind: 'live', mark: 'T', palette: ['#9146FF', '#3A1A72', '#0D0518'],
    accent: '#B18CFF',
    hero: { kicker: 'Twitch · in diretta', title: '3 canali che segui', meta: ['LIVE'], cta: 'Apri' },
  },
  {
    id: 'raiplay', img: 'assets/backdrops/raiplay.jpg', label: 'RaiPlay', pkg: 'it.rainet.androidtv',
    kind: 'tv', mark: 'R', palette: ['#00B4D8', '#0A3D5C', '#04141D'],
    accent: '#5FD6EE',
    hero: { kicker: 'RaiPlay', title: 'Diretta Rai 1', meta: ['TV'], cta: 'Apri' },
  },
  {
    id: 'disney', img: 'assets/backdrops/disney.jpg', label: 'Disney+', pkg: 'com.disney.disneyplus',
    kind: 'film', mark: 'D', palette: ['#113CCF', '#0B1B5E', '#050A1E'],
    accent: '#6E8CFF',
    hero: { kicker: 'Disney+', title: 'La tua lista', meta: ['12 titoli'], cta: 'Apri' },
  },
  {
    id: 'hdmi1', img: 'assets/backdrops/hdmi1.jpg', label: 'HDMI 1', pkg: 'input.hdmi1',
    kind: 'input', mark: '1', palette: ['#4A5A6B', '#1B2530', '#080C11'],
    accent: '#9FB4C6',
    hero: { kicker: 'Ingresso', title: 'HDMI 1', meta: ['PlayStation 5'], cta: 'Passa a' },
  },
];

/* The server probes a TCP connect per port, so a row can honestly show the port it
   knocked on and how long the handshake took. */
const SERVICES = [
  { name: 'jellyfin',    port: 8096, ms: 3,  up: true  },
  { name: 'grafana',     port: 3000, ms: 5,  up: true  },
  { name: 'dokploy',     port: 3001, ms: 4,  up: true  },
  { name: 'immich',      port: 2283, ms: 8,  up: true  },
  { name: 'qbittorrent', port: 8080, ms: 6,  up: true  },
  { name: 'sonarr',      port: 8989, ms: 11, up: true  },
  { name: 'radarr',      port: 7878, ms: 0,  up: false },
  { name: 'prowlarr',    port: 9696, ms: 9,  up: true  },
  { name: 'cloudflared', port: 2000, ms: 2,  up: true  },
];
