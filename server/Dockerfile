# syntax=docker/dockerfile:1

# ---- deps: install the full workspace so npm workspaces resolve correctly ----
# `npm ci`, not `npm install`: ci installs exactly what package-lock.json names
# and fails loudly when the lockfile and the manifests disagree. With `install`
# a build is free to resolve a version the lockfile does not name, which makes
# an image digest a weaker statement than it looks.
FROM node:24-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

# ---- dev: ts-node-dev with hot reload ----
FROM deps AS dev
COPY server/prisma ./server/prisma
RUN npx prisma generate --schema=./server/prisma/schema.prisma
WORKDIR /app/server
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- build: compile TypeScript + generate the Prisma client ----
FROM deps AS build
COPY . .
RUN npm run build -w server

# ---- prod-deps: runtime dependencies only ----
# A separate install rather than a prune of the build tree, because the build
# tree contains typescript, vitest, supertest, eslint, ts-node-dev and every
# @types package — none of which belong in a container facing the internet.
FROM node:24-alpine AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
# --ignore-scripts for two reasons. The root `prepare` script runs husky, which
# is a devDependency and therefore absent here, so the install would exit 127.
# And a production install has no business executing arbitrary package scripts:
# the only postinstall that matters is @prisma/client's, whose output is copied
# from the build stage below instead.
RUN npm ci --omit=dev --ignore-scripts

# ---- prod: run compiled JS only, as a non-root user ----
FROM node:24-alpine AS prod
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
# The root filesystem is read-only in production. Point the npm cache at a
# writable tmpfs and stop the Prisma CLI phoning home for version checks, so
# `npx prisma migrate deploy` has nowhere it needs to write outside /tmp.
ENV npm_config_cache=/tmp/.npm
ENV CHECKPOINT_DISABLE=1

COPY --from=prod-deps /app/node_modules ./node_modules
# The pruned tree has @prisma/client and the prisma CLI, but neither the
# generated client nor the engine binaries, because `prisma generate` and the
# @prisma/engines postinstall were both skipped by --ignore-scripts above.
# Bring both across from the build stage, where the full install ran them.
#
# @prisma/engines is not optional: `prisma migrate deploy` needs the
# schema-engine binary, and without it the CLI tries to download one at runtime
# and fails on a read-only filesystem it could not write to anyway.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/package.json ./server/package.json

# Only the uploads directory needs to be writable, and it is chowned on its own
# rather than with a recursive chown of /app — a `chown -R` over node_modules
# rewrites every file into a new layer and would add hundreds of megabytes.
# Docker copies this ownership onto a fresh named volume mounted here, which is
# what lets the non-root process write uploads at all.
RUN mkdir -p /app/server/uploads && chown node:node /app/server/uploads
USER node

WORKDIR /app/server
EXPOSE 4000
CMD ["node", "dist/index.js"]
