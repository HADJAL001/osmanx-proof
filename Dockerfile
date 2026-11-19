# R4 local/staging only. Put a TLS reverse proxy and reviewed secrets in front of any deployment.
FROM node:22.16.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migration ./migration
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3100
ENV NODE_ENV=development HOST=0.0.0.0 PORT=3100 DATABASE_PATH=/app/data/proof.sqlite PAYMENT_MODE=disabled
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3100/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
