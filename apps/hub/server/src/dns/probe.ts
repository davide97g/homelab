import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";

// One DNS question over UDP, by hand: twelve header bytes and a question.
//
// The name asked is a random label under example.com, so no cache can answer
// it -- AdGuard runs an optimistic cache that would keep answering a popular
// name long after its upstreams died. NOERROR and NXDOMAIN both count as
// healthy (example.com has answered either, depending on the resolver): both
// can only come from an upstream that answered. SERVFAIL, REFUSED or silence
// are what failure looks like.

export type ProbeResult = { ok: boolean; ms: number; detail: string };

const RCODE = ["NOERROR", "FORMERR", "SERVFAIL", "NXDOMAIN", "NOTIMP", "REFUSED"];

function query(id: number, name: string): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // recursion desired
  header.writeUInt16BE(1, 4); // one question
  const labels = name.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, "ascii")]));
  const tail = Buffer.from([0, 0, 1, 0, 1]); // root, type A, class IN
  return Buffer.concat([header, ...labels, tail]);
}

export function probe(host: string, port = 53, timeoutMs = 2500): Promise<ProbeResult> {
  const id = randomBytes(2).readUInt16BE(0);
  const name = `hub-probe-${randomBytes(4).toString("hex")}.example.com`;
  const started = Date.now();

  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let finished = false;
    const done = (ok: boolean, detail: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      resolve({ ok, ms: Date.now() - started, detail });
    };
    const timer = setTimeout(() => done(false, `no answer in ${timeoutMs} ms`), timeoutMs);

    socket.on("error", (err) => done(false, err.message));
    socket.on("message", (msg) => {
      if (msg.length < 12 || msg.readUInt16BE(0) !== id) return; // not ours
      const rcode = msg.readUInt16BE(2) & 0x0f;
      const label = RCODE[rcode] ?? `rcode ${rcode}`;
      done(rcode === 0 || rcode === 3, `answered ${label}`);
    });
    socket.send(query(id, name), port, host, (err) => {
      if (err) done(false, err.message);
    });
  });
}
