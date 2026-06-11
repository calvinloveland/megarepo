FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY index.html styles.css app.js sim-core.mjs server.mjs ./
COPY docs ./docs
COPY tests ./tests

ENV PORT=5192
EXPOSE 5192

CMD ["node", "server.mjs"]
