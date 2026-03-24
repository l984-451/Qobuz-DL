FROM node:alpine

WORKDIR /app

COPY . .

RUN npm install

ENV MUSIC_PATH=/app/music

EXPOSE 3000

CMD ["npm", "run", "dev"]
