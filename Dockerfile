FROM node:lts-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN useradd -m seedgpt_user

COPY dist/ ./
COPY package*.json ./

RUN mkdir -p workspace && \
    chown -R seedgpt_user:seedgpt_user /app

USER seedgpt_user

RUN npm ci --omit=dev

RUN git config --global user.email "agent.seedgpt@gmail.com" && \
    git config --global user.name "SeedGPT" && \
    git config --global init.defaultBranch main

CMD ["npm", "start"]
