# DocSync runs as a single Node process with an embedded SQLite database.
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# SQLite lives here. On Render's free tier this directory is ephemeral;
# attach a persistent disk (see render.yaml) to keep data across deploys.
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "src/server.js"]
