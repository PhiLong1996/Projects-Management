# Dev-oriented image: runs `next dev` with the source bind-mounted by
# docker-compose.yml for hot reload, rather than a production build. See
# README.md for a production deployment note.
FROM node:22-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
