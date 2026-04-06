FROM node:20-alpine

WORKDIR /app

CMD ["sh", "-c", "npm install && npm run dev_ip"]
