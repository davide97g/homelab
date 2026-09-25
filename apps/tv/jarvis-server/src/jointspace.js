import https from 'node:https';
import crypto from 'node:crypto';

const HOST = process.env.TV_HOST || '192.168.15.106';
const PORT = 1926;
const ID = process.env.JOINTSPACE_ID || '';
const KEY = process.env.JOINTSPACE_KEY || '';

export const configured = Boolean(ID && KEY);

// The TV serves a self-signed cert and is the only thing on this address, so pinning
// is pointless and verification only gets in the way. keepAlive matters more than it
// looks: this TV's TLS handshake is slow and flaky, and a fresh one per key press
// drops requests, so the digest challenge and the real call must share one socket.
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 1 });

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function parseChallenge(header) {
  const out = {};
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g)) {
    out[m[1]] = m[2] ?? m[3];
  }
  return out;
}

function digestHeader(challenge, method, uri) {
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = md5(`${ID}:${challenge.realm}:${KEY}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = challenge.qop?.split(',')[0].trim() || 'auth';
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  let h =
    `Digest username="${ID}", realm="${challenge.realm}", nonce="${challenge.nonce}", ` +
    `uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
  if (challenge.opaque) h += `, opaque="${challenge.opaque}"`;
  return h;
}

function once(method, uri, body, authHeader) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST, port: PORT, path: uri, method, agent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body ? Buffer.byteLength(body) : 0,
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('TV request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

/** One digest round trip: fetch the 401 challenge, then send the authenticated call. */
async function call(method, path, payload) {
  if (!configured) throw new Error('jointspace not paired');
  const uri = `/6/${path}`;
  const body = payload != null ? JSON.stringify(payload) : undefined;

  const challenge = await once(method, uri, body);
  if (challenge.status !== 401) {
    // No auth demanded (rare) but it still answered.
    return challenge;
  }
  const www = challenge.headers['www-authenticate'];
  if (!www) throw new Error('no digest challenge from TV');

  const authed = await once(method, uri, body, digestHeader(parseChallenge(www), method, uri));
  if (authed.status >= 400) throw new Error(`TV ${method} ${path} -> ${authed.status}`);
  return authed;
}

export async function sendKey(key) {
  await call('POST', 'input/key', { key });
}

export async function powerState() {
  const res = await call('GET', 'powerstate');
  return JSON.parse(res.body || '{}').powerstate ?? null;
}

// The keys the phone remote and the assistant are allowed to send. Kept to an
// allowlist so a bad value can never reach the TV, and every one was confirmed 200.
export const KEYS = new Set([
  'VolumeUp', 'VolumeDown', 'Mute',
  'CursorUp', 'CursorDown', 'CursorLeft', 'CursorRight', 'Confirm', 'Back', 'Home', 'Options',
  'PlayPause', 'Play', 'Pause', 'Stop', 'FastForward', 'Rewind', 'Next', 'Previous',
  'Source', 'Info',
]);
