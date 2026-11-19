# Staging build only. Requires npm registry access for Next.js dependencies.
FROM node:22.16.0-bookworm-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm run build
FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
ENV NODE_ENV=production
CMD ["./node_modules/.bin/next","start","-H","0.0.0.0","-p","3000"]
