FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production && rm -rf ~/.npm

COPY server.js ./

EXPOSE 8787

ENV PORT=8787

CMD ["node", "server.js"]
