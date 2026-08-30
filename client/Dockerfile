# syntax=docker/dockerfile:1

# ---- deps: install the full workspace so npm workspaces resolve correctly ----
# `npm ci`, not `npm install`: ci installs exactly what package-lock.json names
# and fails when the lockfile and the manifests disagree, so what CI builds is
# reproducible against the lockfile rather than against whatever resolved today.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci

# ---- dev: vite dev server with hot reload ----
FROM deps AS dev
WORKDIR /app/client
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build: produce static assets ----
FROM deps AS build
COPY . .
RUN npm run build -w client

# ---- prod: serve static assets with nginx ----
FROM nginx:1.27-alpine AS prod
COPY --from=build /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
