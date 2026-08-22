# syntax=docker/dockerfile:1

# ---- deps: install full workspace so npm workspaces resolve correctly ----
FROM node:24-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm install

# ---- dev: ts-node-dev with hot reload ----
FROM deps AS dev
COPY server/prisma ./server/prisma
RUN npx prisma generate --schema=./server/prisma/schema.prisma
WORKDIR /app/server
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- build: compile TypeScript + generate Prisma client ----
FROM deps AS build
COPY . .
RUN npm run build -w server

# ---- prod: run compiled JS only ----
FROM node:24-alpine AS prod
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/package.json ./server/package.json
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
