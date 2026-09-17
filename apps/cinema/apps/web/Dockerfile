# Build the SPA, then serve it from nginx together with a /jf proxy to
# Jellyfin. Same-origin in production for exactly the reason it is same-origin
# in dev: no CORS, and byte-range video requests pass through untouched.
FROM oven/bun:1-alpine AS build
WORKDIR /repo

COPY package.json ./
COPY packages ./packages
COPY apps/web/package.json apps/web/bun.lock ./apps/web/
RUN cd apps/web && bun install --frozen-lockfile

COPY apps/web ./apps/web
RUN bun run packages/design-tokens/build.ts && cd apps/web && bun run build

FROM nginx:1.27-alpine
COPY services/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# nginx:alpine renders /etc/nginx/templates/*.template with envsubst at boot,
# which is how JELLYFIN_UPSTREAM reaches the config.
ENV JELLYFIN_UPSTREAM=http://jellyfin:8096
EXPOSE 80
