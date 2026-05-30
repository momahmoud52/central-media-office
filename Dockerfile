FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package.json
COPY server.js server.js
COPY public public
COPY data data

RUN mkdir -p /app/data

EXPOSE 4173

CMD ["node", "server.js"]
