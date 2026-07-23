# bookworm rather than alpine: better-sqlite3 ships glibc prebuilds, and musl
# would force a source build with python3 and g++ in the image.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY shared ./shared
RUN npm run build

# The extension has the server origin baked into its manifest, so it is built
# here against the same URL the site will be served from.
ARG PUBLIC_URL=https://hoppy.ovh
COPY extension ./extension
RUN node extension/build.mjs --zip --server "$PUBLIC_URL"

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public
COPY overlay ./overlay
# The browser is served shared/ from source: dist/shared is the copy the server
# itself imports, and only the source tree carries the stylesheets, which tsc
# does not emit.
COPY shared ./shared
COPY --from=build /app/extension/dist ./extension-dist

ENV SHARED_DIR=/app/shared \
    OVERLAY_DIR=/app/overlay \
    PUBLIC_DIR=/app/public \
    DOWNLOADS_DIR=/app/extension-dist \
    DB_PATH=/data/app.db \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "dist/src/server.js"]
