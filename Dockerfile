FROM node:alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY . .

RUN npm install

ENV MUSIC_PATH=/app/music

EXPOSE 3000

CMD ["npm", "run", "dev"]
