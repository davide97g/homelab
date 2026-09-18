# Two stages: build the frontend and the server with the dev toolchain, then
# carry only the workspace into a clean runtime image.
#
# The built frontend is copied to server/dist/public because the server serves
# it from next to its own entrypoint -- one container, one port, one origin, so
# the session cookie needs no CORS handling and the Cloudflare Tunnel has a
# single thing to point at.

FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Manifests first: a source-only change then reuses the install layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY server/package.json server/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY server server
COPY frontend frontend
RUN pnpm --filter ./frontend build \
 && pnpm --filter ./server build \
 && cp -r frontend/dist server/dist/public

# Drop the dev toolchain from node_modules -- typescript, vite and friends are
# about half the image and none of it is needed to run.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
