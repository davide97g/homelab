# One image: the API (Bun + Hono + Better Auth) serving the built web app.
FROM oven/bun:1-alpine AS build
WORKDIR /repo
COPY package.json bun.lock ./
COPY server/package.json ./server/
COPY web/package.json ./web/
# Hoisted: Bun's default isolated linker puts each workspace's deps in its own
# node_modules (server/node_modules), which the runtime stage would not have.
RUN bun install --frozen-lockfile --linker hoisted
COPY web ./web
RUN cd web && bun run build

FROM oven/bun:1-alpine
WORKDIR /app
# The workspace's node_modules as installed above: dev tools ride along, a
# few MB the NAS does not mind, against a second resolve that kept failing.
COPY --from=build /repo/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY --from=build /repo/web/dist ./web/dist
WORKDIR /app/server
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web/dist MIGRATIONS_DIR=/app/server/drizzle
EXPOSE 3000
# Migrations first: a new column never meets old code.
CMD ["sh", "-c", "bun src/db/migrate.ts && exec bun src/server.ts"]
