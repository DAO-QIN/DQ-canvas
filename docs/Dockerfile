FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS docs-build

WORKDIR /app
RUN npm install --global pnpm@10.34.5
COPY docs/package.json docs/pnpm-lock.yaml docs/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile --ignore-scripts
COPY docs ./
COPY CHANGELOG.md /CHANGELOG.md
RUN pnpm run postinstall
RUN pnpm run build

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=docs-build --chown=nextjs:nodejs /app/public ./public
COPY --from=docs-build --chown=nextjs:nodejs /app/index.md ./index.md
COPY --from=docs-build --chown=nextjs:nodejs /app/content ./content
COPY --from=docs-build --chown=nextjs:nodejs /app/.source ./.source
COPY --from=docs-build --chown=nextjs:nodejs /app/source.config.ts ./source.config.ts
COPY --from=docs-build --chown=nextjs:nodejs /CHANGELOG.md /CHANGELOG.md
COPY --from=docs-build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=docs-build --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
