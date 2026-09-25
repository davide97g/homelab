# Porting an app from a VPS to this box

The blueprint. Three apps have been moved this way — **calorico**, **Thumb
Studio** and **ral-gate**, all on 2026-09-15 — and this is the procedure that came
out of doing it, written so the next one is a checklist rather than a discovery.

The first two were Dokploy **compose** apps; ral-gate is a Dockerfile
**application**. The shape of the port is identical and only the endpoint names
change — see [Porting an application, not a compose app](#porting-an-application-not-a-compose-app).

Credentials and ids for every step are in [`.env`](.env) beside this file. Read
that first; nothing below asks you to go looking for a key.

---

## What you are porting *to*

Three things, and knowing where one ends and the next begins is most of the job:

| Layer | What it does | Where its config lives |
|---|---|---|
| **Dokploy** (`:3000`) | builds the repo, runs the compose stack, writes Traefik labels | its own REST API, `DOKPLOY_*` in `.env` |
| **Traefik** (`:80`/`:443`) | routes by `Host` header to the right container | Dokploy's "domain" record for the app |
| **cloudflared** | publishes a hostname on the internet | Cloudflare Zero Trust, `CF_*` in `.env` |

**The box forwards no port.** There is no inbound hole in the router; the tunnel
dials *out* to Cloudflare and traffic comes back down that connection. Three
consequences that shape everything else:

- **Cloudflare terminates TLS.** The app's Dokploy domain must therefore be
  `https: false`, `certificateType: none`. Traefik serves plain HTTP on its `web`
  entrypoint and asks Let's Encrypt for nothing — a certificate here would be a
  second handshake to nowhere, and on a VPS-shaped config it is the first thing
  that is wrong.
- **DNS is a proxied CNAME to `$CF_TUNNEL_CNAME`**, never an A record at an
  address. An A record is the shape the VPS left behind; replacing it *is* the
  cutover.
- **Traffic is in the clear at Cloudflare's edge.** If the app carries anything
  regulated, that belongs in its privacy documentation — calorico's `docs/ropa.md`
  had to name Cloudflare as a processor and drop the hosting provider entirely.
  Data at rest is now on hardware you are responsible for: disk encryption,
  physical access and OS updates are yours, not a datacenter's.

Every tunnel ingress rule points at `http://localhost:<port>` — **never the LAN
IP**. The lease moved once already (2026-09-14) and every config with a baked-in
address broke at the same moment.

---

## Before you start

Three decisions, none of which are worth discovering halfway through:

1. **Does the old side get deleted, stopped, or left running?** "Left running" is
   the wrong answer: DNS decides who serves, and the loser accumulates a database
   that silently drifts from the winner. Stop it at minimum.
2. **What is the app's data?** A Postgres volume is the usual answer and is easy.
   Object storage usually needs *nothing* — both Thumb Studio and its replacement
   pointed at the same Cloudflare R2 bucket with the same keys, so images kept
   working through the flip without a byte moving. Check for anything on a host
   path, though; that does not travel.
3. **Is there a build-time secret?** Vite-style `VITE_*` variables are baked into
   the bundle and reach the image as compose `build.args`, not container env. They
   need a rebuild to change, and a deploy that forgets one produces an app that
   serves fine and cannot sign anyone in.

---

## The runbook

### 0. Survey the old side

Ask the *old* Dokploy for the compose config rather than reconstructing it from
the repo. Its `env` field is the real production environment, including the keys
nobody wrote down:

```sh
curl -sS -H "x-api-key: $OLD_KEY" \
  "$OLD_URL/api/compose.one?composeId=$OLD_ID" > old-compose.json
```

Note `env`, `owner`/`repository`/`branch`/`composePath`, and the `domains` array.
Everything in step 2 comes from this file, copied rather than retyped.

### 1. Create the project and the compose app

```sh
echo '{"name":"myapp","description":"…"}' | dk POST project.create
echo '{"name":"myapp","appName":"myapp","description":"…",
       "projectId":"…","environmentId":"…","composeType":"docker-compose"}' \
  | dk POST compose.create
```

**Pass `appName` at creation.** It is fixed then and there: `compose.update`
accepts the field and silently ignores it, so the only way to change it later is
to delete the app and make another. Omit it and you get a Dokploy-generated
phrase like `compose-parse-digital-alarm-o534bk` as your container prefix
forever. Dokploy appends its own suffix either way — `myapp` becomes
`myapp-bzzqoz`, which is fine and is how you tell two deployments of the same
name apart.

### 2. Point it at the repo, give it the environment, give it the domain

```sh
dk POST compose.update <<< '{
  "composeId":"…","sourceType":"github","composeType":"docker-compose",
  "githubId":"'"$DOKPLOY_GITHUB_ID"'","owner":"davide97g","repository":"myapp",
  "branch":"main","composePath":"./docker-compose.yml",
  "autoDeploy":false,"env":"<verbatim from step 0>"
}'
dk POST domain.create <<< '{
  "host":"myapp.davideghiotto.it","path":"/","port":80,"serviceName":"web",
  "domainType":"compose","https":false,"certificateType":"none","composeId":"…"
}'
```

`autoDeploy` is **false** on purpose — see step 7. `https: false` and
`certificateType: none` are the tunnel rule from the top of this document.

### 3. Deploy, and verify it *before* touching DNS

```sh
echo '{"composeId":"…"}' | dk POST compose.deploy
```

The app is now running and completely unreachable from the internet, which is
exactly the right time to test it. Traefik routes on the `Host` header, so ask
for it by name over localhost on the box:

```sh
ssh homelab 'curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Host: myapp.davideghiotto.it" http://localhost/api/health'
```

Check every entrypoint the app has, not just the root — for Thumb Studio that was
`/`, `/welcome`, `/api/health`, `/api/auth/status` and `/api/mcp/health`. A 404
here is Traefik saying it has no route for that host: the domain record or the
`dokploy-network` membership is wrong, and it is much cheaper to find now.

### 4. Move the data

Dump from inside the old container, restore into the new one. There is no
container-exec endpoint in Dokploy's API, so both halves go over SSH.

```sh
ssh oldhost 'docker exec <old-pg> pg_dump -U user -d db \
  --clean --if-exists --no-owner --no-privileges | gzip -9' > dump.sql.gz

scp dump.sql.gz homelab:/tmp/
ssh homelab '
  mkdir -p ~/backups/myapp && cp /tmp/dump.sql.gz ~/backups/myapp/myapp-vps-$(date +%Y%m%d-%H%M).sql.gz
  docker stop <new-api>
  gunzip -c /tmp/dump.sql.gz | docker exec -i <new-pg> psql -U user -d db -q
  docker start <new-api>'
```

Four things about that:

- **`--clean --if-exists`, because the app already created its schema.** The API
  ran its migrations on first boot; the dump drops and recreates everything,
  migration journal included, so the restored database knows exactly which
  migrations it has had. Restoring *without* `--clean` into a live schema is how
  you get half a database.
- **Stop the API first.** It holds connections, and `DROP TABLE` against a live
  writer is a deadlock waiting to happen.
- **`--no-owner --no-privileges` only if the app has no role separation.** If it
  uses RLS with a second role — calorico does — those grants are *data you need*,
  and dropping them leaves an app where login works and every real request
  answers 500. Restore with privileges, or re-run the `GRANT`s afterwards.
- **Keep the dump in two places.** `~/backups/<app>/` on the box and a copy on the
  Mac. It is the only thing standing between a bad cutover and a lost database,
  and it is one megabyte.

Then compare both sides before you trust it:

```sh
psql -Atc "select relname, n_live_tup from pg_stat_user_tables order by relname"
```

Run it on the old host and the new one and diff the output. Identical counts are
the go signal; a difference means someone wrote to the old side after your dump,
and you dump again.

### 5. Cut over Cloudflare — ingress first, then DNS

Order matters: a DNS record pointing at a tunnel with no matching ingress rule is
a 404 for real users.

**Ingress.** The API replaces the *whole* config, so read it, insert, write it
back — and keep the catch-all last, or it swallows the rules after it:

```sh
cf GET  "accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations"
cf PUT  "accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations" <<< '{"config":{"ingress":[…]}}'
```

Two entries per app:

| hostname | path | service |
|---|---|---|
| `myapp.davideghiotto.it` | — | `http://localhost:80` |
| `deploy-myapp.davideghiotto.it` | `api/compose\.(deploy\|one)` | `http://localhost:3000` |

The second one is step 7's; add it now while you are in the file.

**DNS.** Create the deploy hostname, then replace the app's A record in place —
`PUT` on the existing record id, so the change is one atomic edit rather than a
delete and a create with a gap in between:

```sh
cf POST "zones/$CF_ZONE_ID/dns_records" <<< '{"type":"CNAME","name":"deploy-myapp","content":"'"$CF_TUNNEL_CNAME"'","proxied":true,"ttl":1}'
cf PUT  "zones/$CF_ZONE_ID/dns_records/<id>" <<< '{"type":"CNAME","name":"myapp","content":"'"$CF_TUNNEL_CNAME"'","proxied":true,"ttl":1}'
```

`proxied: true` is not optional — an unproxied CNAME to `cfargotunnel.com` points
at nothing.

### 6. Prove it is actually the new box

The app answering on its public URL proves nothing while the old one is still up:
DNS caches, and you will believe the wrong thing. **Stop the old stack and ask
again.**

```sh
echo '{"composeId":"'$OLD_ID'"}' | dk-old POST compose.stop
curl -s https://myapp.davideghiotto.it/api/health
```

That is the only test that distinguishes "it works" from "it works from the
machine I am retiring". While you are there, check the certificate issuer — it
should now be Cloudflare's edge (`Google Trust Services`), not Let's Encrypt:

```sh
echo | openssl s_client -connect myapp.davideghiotto.it:443 \
  -servername myapp.davideghiotto.it 2>/dev/null | openssl x509 -noout -issuer
```

### 7. Let CI deploy, and nothing else

Dokploy's auto-deploy fires on the push, which means it deploys code the tests
have not judged yet. Turn it off and let the pipeline do it, so there is exactly
one path from `main` to production and it runs behind the gate.

GitHub Actions cannot reach a private LAN, hence `deploy-myapp.davideghiotto.it`
from step 5 — **a hostname whose tunnel path rule allows the two calls the deploy
job makes and nothing else.** `api/compose\.(deploy|one)` exposes "start a deploy"
and "how did it go"; everything else on Dokploy's admin API, including
`project.all`, answers 404 at Cloudflare's edge before it reaches the box. Verify
both halves:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://deploy-myapp.davideghiotto.it/api/compose.one?composeId=x  # 401 — reached Dokploy
curl -s -o /dev/null -w '%{http_code}\n' https://deploy-myapp.davideghiotto.it/api/project.all              # 404 — never did
```

Three repository secrets — `DOKPLOY_URL` (the deploy hostname), `DOKPLOY_API_KEY`,
`DOKPLOY_COMPOSE_ID` — and a job that triggers the deploy *and waits for its
result*. The waiting is the point: a red deploy under a green workflow is the
failure this job exists to prevent. Copy the job from
[`calorico`](https://github.com/davide97g/calorico/blob/main/.github/workflows/ci.yml)
or `yt-thumb-gen`; both are the same shape.

Two details in it that are not obvious:

- **Record the newest deployment id before triggering.** For the first few
  seconds the compose status still reads `done` from the *previous* deploy, so
  status alone cannot tell you whether yours has started. The id can.
- **`compose.one` returns deployments oldest first.** Sort by `createdAt` and take
  the last. Reading `[0]` gives you the status of the app's very first deploy,
  forever.

Also set `cancel-in-progress: false` on the workflow's concurrency group. Once CI
deploys, a cancelled run leaves `main` green and undeployed, and two quick pushes
deploy out of order.

### 8. Tear down the old side

Only after step 6 passed and the dump is in two places.

```sh
echo '{"composeId":"…","deleteVolumes":true}' | dk-old POST compose.delete
echo '{"projectId":"…"}'                      | dk-old POST project.remove
ssh oldhost 'docker images | grep myapp'   # delete the orphans it leaves behind
```

Check what else lives in that Dokploy project first — `project.remove` takes
everything in it.

### 9. Write it down

The ids you just generated are the ones the next change needs. They go in the
app repo's own gitignored `.env`, **not** in the Dokploy environment — the key
manages the deployment, so the deployment must not be able to read it. Update the
app's `CLAUDE.md` / README where it says "VPS", and add a line to this box's
[README](README.md).

---

## Porting an application, not a compose app

A Dokploy **application** — one Dockerfile, no compose file — ports exactly the
same way. Every `compose.*` call becomes `application.*`, and what a compose app
sets in a single `compose.update` is spread over four narrower endpoints.
ral-gate went across this way.

```sh
echo '{"name":"ral-gate","description":"…"}' | dk POST project.create
```

**`project.create` answers `{"project":{…},"environment":{…}}`**, not a bare
project — both ids you need are in there, so there is no follow-up `project.one`.
(`project.one` on a compose port reads the same ids out of `environments[0]`.)

```sh
echo '{"name":"ral-gate-api","appName":"ral-gate-api","description":"…",
       "projectId":"…","environmentId":"…"}' | dk POST application.create
```

Then, in this order:

| Step | Call | Fields |
|---|---|---|
| source | `application.saveGithubProvider` | `githubId`, `owner`, `repository`, `branch`, `buildPath`, `watchPaths`, `triggerType`, `enableSubmodules` |
| build | `application.saveBuildType` | `buildType: "dockerfile"`, `dockerfile`, `dockerContextPath`, `dockerBuildStage`, **`herokuVersion`**, **`railpackVersion`** |
| env | `application.saveEnvironment` | `env`, `buildArgs`, **`buildSecrets`**, **`createEnvFile`** |
| volume | `mounts.create` | `type: "volume"`, `volumeName`, `mountPath`, `serviceType: "application"`, `serviceId` |
| domain | `domain.create` | `domainType: "application"`, `applicationId`, `host`, `port`, `https: false`, `certificateType: "none"` |
| CI, not webhooks | `application.update` | `autoDeploy: false` |

**The bold fields are not optional and have no defaults.** `saveBuildType` and
`saveEnvironment` both reject a body without them — `"expected nonoptional,
received undefined"` — even though nothing about a Dockerfile build uses a Heroku
or a Railpack version. Copy the values off the old app (`herokuVersion: "24"`,
`railpackVersion: "0.15.4"`) rather than inventing them.

Deploy and control with `application.deploy` / `.stop` / `.start`, and read status
from `application.one?applicationId=…`. `applicationStatus` goes `idle` →
`running` → `done`.

The deploy hostname's path rule is therefore
`api/application\.(deploy|one)`, not the compose one. **Escape the dot once.** A
config written through `python -c` inside single quotes needs `\\.` in the shell,
which is `\.` in the JSON and one backslash on the wire; get it wrong and the
rule reads `api/application\\.(deploy|one)`, matches nothing, and every CI deploy
404s at the edge.

### Moving a SQLite volume

There is no dump step — the database *is* a file — but three things bite.

**Checkpoint the WAL, or you copy an empty database.** ral-gate's volume held a
4 KB `ral-gate.sqlite` beside a 552 KB `-wal`: every row was in the write-ahead
log. Stopping the container does not fold it back in. Do it explicitly, after the
app is stopped, and the main file grows and the `-wal`/`-shm` pair disappears:

```sh
ssh oldhost 'docker run --rm -v <vol>:/v alpine sh -c "
  apk add -q --no-cache sqlite &&
  sqlite3 /v/app.sqlite \"PRAGMA wal_checkpoint(TRUNCATE);\" &&
  sqlite3 /v/app.sqlite \"PRAGMA integrity_check;\""'
```

Then stream it across and back into the new volume, with the app stopped on both
sides — a throwaway `alpine` container is the way to touch a volume without root,
since `/var/lib/docker/volumes/` is not readable by the login user:

```sh
ssh oldhost 'docker run --rm -v <vol>:/v alpine cat /v/app.sqlite' > app.sqlite
scp app.sqlite homelab:/tmp/
ssh homelab 'docker run --rm -v <vol>:/v -v /tmp:/in alpine sh -c "
  rm -f /v/app.sqlite /v/app.sqlite-wal /v/app.sqlite-shm &&
  cp /in/app.sqlite /v/app.sqlite && chown 1000:1000 /v/app.sqlite"'
```

**That `chown` is not cosmetic.** The copy lands owned by root, and an image with
`USER node` runs as uid 1000: the app opens the database, serves reads, and fails
the first write. Match the ownership the old volume had.

Compare row counts on both sides before trusting it — the SQLite equivalent of
the `pg_stat_user_tables` diff in step 4:

```sh
docker run --rm -v <vol>:/v alpine sh -c \
  'apk add -q --no-cache sqlite; for t in $(sqlite3 /v/app.sqlite ".tables"); do
     echo -n "$t="; sqlite3 /v/app.sqlite "select count(*) from $t"; done'
```

---

## API cookbook

Both APIs are plain JSON over HTTP. Helpers worth having on hand:

```sh
dk() {  # dk GET path | dk POST path  (body on stdin)
  . ~/personal/projects/homelab/.env
  [ "$1" = GET ] \
    && curl -sS -H "x-api-key: $DOKPLOY_API_KEY" "$DOKPLOY_URL/api/$2" \
    || curl -sS -X POST -H "x-api-key: $DOKPLOY_API_KEY" \
         -H 'content-type: application/json' --data-binary @- "$DOKPLOY_URL/api/$2"
}

cf() {  # cf GET path | cf POST|PUT path  (body on stdin)
  . ~/personal/projects/homelab/.env
  [ "$1" = GET ] \
    && curl -sS -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/$2" \
    || curl -sS -X "$1" -H "Authorization: Bearer $CF_API_TOKEN" \
         -H 'content-type: application/json' --data-binary @- "https://api.cloudflare.com/client/v4/$2"
}
```

**Send POST bodies on stdin.** A helper written as `-d "${1:-{}}"` mangles the
body in bash and Dokploy answers `{"code":"PARSE_ERROR"}`, which reads like a
schema problem and is not one.

| Want | Call |
|---|---|
| list everything | `dk GET project.all` |
| one app's full config | `dk GET "compose.one?composeId=…"` |
| change source or env | `dk POST compose.update` |
| deploy / redeploy / stop | `dk POST compose.deploy` / `.redeploy` / `.stop` |
| add a domain | `dk POST domain.create` |
| which GitHub repos are visible | `dk GET "github.getGithubRepositories?githubId=$DOKPLOY_GITHUB_ID"` |
| tunnel ingress | `cf GET/PUT "accounts/$CF_ACCOUNT_ID/cfd_tunnel/$CF_TUNNEL_ID/configurations"` |
| a DNS record | `cf GET "zones/$CF_ZONE_ID/dns_records?name=myapp.davideghiotto.it"` |

---

## Traps, in the order they bite

**`dokploy-network` service names are global.** Every compose stack on this box
publishes its service names as aliases on the shared network Traefik lives on, so
a stack whose backend is called `api` is one of several answering to `api`.
Docker's DNS hands back all of them and your nginx proxies `/api` to a stranger's
container. The symptom is unmistakable once you know it: every API route 404s in
*another framework's* error shape. Give internal services a stack-scoped alias —
`myapp-api`, `myapp-mcp` — and resolve those.

**A container routed by Traefik must join `dokploy-network` explicitly.** Without
it you get Traefik's default certificate and a 404, which looks like a DNS
problem and is not.

**Healthchecks must use `127.0.0.1`, not `localhost`.** A custom `nginx.conf`
usually drops the entrypoint's IPv6 listener; busybox `wget` tries `::1` first,
fails, the container goes unhealthy and Traefik removes it from rotation.

**`user/tokens/verify` returns "Invalid API Token" for a correctly-scoped token.**
The endpoint is itself a scope the token does not have. Test against something you
actually need — `cf GET "zones?name=$CF_ZONE"` — and ignore the verify call.

**Universal SSL covers one label, and only one.** The free certificate is issued
for `davideghiotto.it` and `*.davideghiotto.it`, so a two-label host like
`admin.wedding.davideghiotto.it` has no certificate at Cloudflare's edge and every
HTTPS request to it dies in the handshake — `sslv3 alert handshake failure`, while
plain HTTP answers 200. On a VPS such a name usually survives grey-clouded, with
Traefik's own Let's Encrypt certificate; a tunnel cannot, because a CNAME to
`cfargotunnel.com` has to be proxied. Either buy Advanced Certificate Manager or
flatten the name — wedding's dashboard became `wedding-admin.davideghiotto.it`.
Check for a two-label hostname in step 0, not after the cutover.

**`compose.update` ignores `appName`.** See step 1.

**`application.saveBuildType` and `.saveEnvironment` demand fields a Dockerfile
build never uses.** `herokuVersion`, `railpackVersion`, `buildSecrets`,
`createEnvFile` — all non-optional, all rejected as `undefined`. See the
application section.

**A SQLite volume can look empty and not be.** The rows are in the `-wal` file
until something checkpoints it, and stopping the container does not. See the
application section.

**`compose.one` returns deployments oldest first.** See step 7.

**Cloudflare 403s the default `Python-urllib` User-Agent.** If you script against
anything behind Cloudflare, send `user-agent: curl/…` or you get a bare 403 that
reads like an auth failure.

---

## What has been ported

| App | Public URL | Dokploy project | Deploy hostname | Moved |
|---|---|---|---|---|
| calorico | `calorico.davideghiotto.it` | `calorico` | `deploy-calorico.…` | 2026-09-15 |
| Thumb Studio | `thumb.davideghiotto.it` | `thumb-studio` | `deploy-thumb.…` | 2026-09-15 |
| ral-gate | `ral-api.davideghiotto.it` | `ral-gate` | `deploy-ral.…` | 2026-09-15 |
| wedding | `wedding.davideghiotto.it` + `wedding-admin.…` | `wedding` | `deploy-wedding.…` | 2026-09-15 |

All from the same Hetzner VPS, all deleted on the far side afterwards, all with
their dump kept in `~/backups/<app>/` on the box and a copy on the Mac. wedding
was the last thing on that VPS, which is now empty.
