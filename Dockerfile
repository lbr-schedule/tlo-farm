FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@8 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/

RUN pnpm install

WORKDIR /app

COPY . .

RUN pnpm install

RUN pnpm -r --parallel --filter='@tlo-farm/client' run build

EXPOSE 3001

CMD ["sh", "-c", "pnpm --filter @tlo-farm/server exec tsx src/index.ts"]
