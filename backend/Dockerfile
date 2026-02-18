FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache postgresql-client python3 py3-pip \
  && python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir nalogapi pysocks

WORKDIR /app
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/venv/bin:${PATH}"
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/subpage-00000000-0000-0000-0000-000000000000.json ./

RUN npx prisma generate

EXPOSE 5000
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
