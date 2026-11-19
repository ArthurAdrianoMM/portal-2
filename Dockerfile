# portal-2 serve, for hosting (docs/HOSTING.md). The same server as `npx portal-2 serve`,
# configured by the environment: PUBLIC_URL is the address people use.

# Build: the web app into dist/web, the server into dist/.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src src
COPY web web
RUN npm run build

# Run: production dependencies and the build, nothing else.
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    PORTAL2_DATA_DIR=/data \
    NO_UPDATE_NOTIFIER=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist dist
# The remembered sessions live here (a volume), readable by the app's user only.
RUN mkdir -m 700 /data && chown node:node /data
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/cli/main.js", "serve"]
