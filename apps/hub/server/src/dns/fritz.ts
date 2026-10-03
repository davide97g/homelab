import { pbkdf2Sync } from "node:crypto";
import { config } from "../config.js";
import { request, ServiceError } from "../http.js";

// The FRITZ!Box's upstream DNS, read and switched through its own web UI.
//
// Not TR-064: on FRITZ!OS 8.25 the DNS servers are read-only there
// (GetDNSServers, X_GetDNSServers, no setter). So this posts the same form the
// web UI does -- data.lua, page dnsSrv -- which is undocumented and may move
// with a firmware update. Every failure says so in its message.
//
// What it can do is deliberately one-sided. Pointing the upstream at a custom
// server comes back `"apply": "twofactor"`: the box wants a button press, an
// authenticator code or a phone code. Switching back to the provider's servers
// does not. That asymmetry is the whole design: the hub can fail over by itself
// (AdGuard -> provider) and never the other way. Measured 2026-10-03; see
// apps/adguard/README.md.
//
// One session is kept and reused, because every login is a line in the
// FRITZ!Box event log, and a poll that logs in each time would bury the lines
// that matter there.

const NO_SESSION = "0000000000000000";

let sid: string | null = null;

export function fritzConfigured(): boolean {
  return Boolean(config.fritz.user && config.fritz.pass);
}

function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

/** AVM's challenge-response, version 2: PBKDF2 twice, the second over the first. */
async function login(): Promise<string> {
  const base = config.fritz.url;
  // request() asks for JSON by default, and login_sid.lua then answers in JSON;
  // the XML form is the documented one.
  const xmlHeaders = { accept: "application/xml" };
  const challengeXml = await (
    await request(`${base}/login_sid.lua?version=2`, { headers: xmlHeaders, timeoutMs: 8000 })
  ).text();
  const challenge = /<Challenge>(.*?)<\/Challenge>/.exec(challengeXml)?.[1] ?? "";
  const [v, iter1, salt1, iter2, salt2] = challenge.split("$");
  if (v !== "2" || !iter1 || !salt1 || !iter2 || !salt2) {
    throw new ServiceError("the FRITZ!Box did not offer a PBKDF2 login challenge");
  }
  const hash1 = pbkdf2Sync(config.fritz.pass, Buffer.from(salt1, "hex"), Number(iter1), 32, "sha256");
  const hash2 = pbkdf2Sync(hash1, Buffer.from(salt2, "hex"), Number(iter2), 32, "sha256");
  const res = await request(`${base}/login_sid.lua?version=2`, {
    method: "POST",
    headers: { ...xmlHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: form({ username: config.fritz.user, response: `${salt2}$${hash2.toString("hex")}` }),
    timeoutMs: 8000,
  });
  const xml = await res.text();
  const got = /<SID>(.*?)<\/SID>/.exec(xml)?.[1] ?? NO_SESSION;
  if (got === NO_SESSION) {
    const block = /<BlockTime>(\d+)<\/BlockTime>/.exec(xml)?.[1];
    throw new ServiceError(
      `the FRITZ!Box refused the login for ${config.fritz.user}${block && block !== "0" ? ` (blocked for ${block} s)` : ""}`,
    );
  }
  return got;
}

type DataReply = {
  sid?: string;
  data?: {
    apply?: string;
    twofactor?: string;
    valerror?: { ok?: boolean; result?: string };
    vars?: { ipv4?: { userdns?: { value?: string }; firstdns?: { value?: string }; seconddns?: { value?: string } } };
  };
};

/** One data.lua call, logging in first if there is no session, and once more if
 *  the session it had has expired (20 idle minutes on the box's side). */
async function data(fields: Record<string, string>, retried = false): Promise<DataReply> {
  sid ??= await login();
  const res = await request(`${config.fritz.url}/data.lua`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ xhr: "1", sid, lang: "en", page: "dnsSrv", ...fields }),
    timeoutMs: 10_000,
  });
  let reply: DataReply | null = null;
  try {
    reply = (await res.json()) as DataReply;
  } catch {
    // An expired session is answered with the login page, not JSON.
  }
  if (!reply || reply.sid === NO_SESSION) {
    sid = null;
    if (retried) throw new ServiceError("the FRITZ!Box answered data.lua with something other than its DNS page");
    return data(fields, true);
  }
  return reply;
}

export type FritzDns = {
  /** "custom": the upstream is the servers below (AdGuard, as set up here).
   *  "provider": the ISP's own resolvers, i.e. AdGuard is bypassed. */
  mode: "custom" | "provider";
  servers: string[];
};

export async function readFritzDns(): Promise<FritzDns> {
  const reply = await data({ xhrId: "all" });
  const v4 = reply.data?.vars?.ipv4;
  if (!v4?.userdns) throw new ServiceError("the FRITZ!Box DNS page has changed shape; see dns/fritz.ts");
  return {
    mode: v4.userdns.value === "1" ? "custom" : "provider",
    servers: [v4.firstdns?.value, v4.seconddns?.value].filter((s): s is string => Boolean(s && s !== "0.0.0.0")),
  };
}

/** The failover: hand DNS back to the provider. The custom addresses stay
 *  stored on the box, so returning is one radio button and the confirmation. */
export async function useProviderDns(): Promise<void> {
  const reply = await data({ apply: "", ipv4_use_user_dns: "0", ipv6_use_user_dns: "0" });
  const d = reply.data ?? {};
  if (d.apply === "ok") return;
  if (d.apply === "twofactor" || d.twofactor) {
    throw new ServiceError("the FRITZ!Box asked for a confirmation (button or code); nothing was changed");
  }
  if (d.valerror && d.valerror.ok === false) {
    throw new ServiceError(`the FRITZ!Box rejected the form: ${d.valerror.result ?? "validation error"}`);
  }
  throw new ServiceError(`unexpected FRITZ!Box reply: ${JSON.stringify(d).slice(0, 160)}`);
}
