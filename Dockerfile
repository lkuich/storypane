FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.4.2
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @storypane/sdk build && pnpm --filter @storypane/web build:node

FROM node:24.22.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node", "--conditions=storypane-node", "--import", "tsx", "apps/web/src/node.ts"]
