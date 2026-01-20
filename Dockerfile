FROM node:18-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm install

COPY server ./server
COPY public ./public

WORKDIR /app/server

EXPOSE 3000

CMD ["npm", "start"]
