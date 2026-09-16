FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

# Host networking is required, not preferred: the TV finds this server by mDNS, and
# a bridged container cannot answer multicast on the LAN the TV is on.
EXPOSE 8787
CMD ["node", "src/index.js"]
