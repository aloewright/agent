FROM docker.io/cloudflare/sandbox:0.7.0

# Install Node.js 22 (required by OpenClaw) and rclone (for R2 persistence)
# The base image has Node 20, we need to replace it with Node 22
# Using direct binary download for reliability
ENV NODE_VERSION=22.13.1
RUN ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
         amd64) NODE_ARCH="x64" ;; \
         arm64) NODE_ARCH="arm64" ;; \
         *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
       esac \
    && apt-get update && apt-get install -y xz-utils ca-certificates rclone \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && node --version \
    && npm --version

# Install pnpm globally
RUN npm install -g pnpm

# Install OpenClaw (formerly clawdbot/openclaw)
# Pin to specific version for reproducible builds
RUN npm install -g openclaw@2026.2.3 \
    && openclaw --version

# Install AI CLI tools for swarm agents (OAuth-based, not API keys)
# Pin versions for reproducible builds
RUN npm install -g @anthropic-ai/claude-code@0.2.91 \
    && claude --version

RUN npm install -g @openai/codex@0.119.0-alpha.11 \
    && codex --version

RUN npm install -g @google/gemini-cli@0.1.36 \
    && gemini --version

# Create OAuth token storage directories
RUN mkdir -p /root/.claude /root/.codex /root/.gemini

# Create OpenClaw directories
# Legacy .clawdbot paths are kept for R2 backup migration
RUN mkdir -p /root/.openclaw \
    && mkdir -p /root/clawd \
    && mkdir -p /root/clawd/skills

# Copy startup script
# Build cache bust: 2026-04-03-v31-swarm-cli-tools
COPY start-openclaw.sh /usr/local/bin/start-openclaw.sh
RUN chmod +x /usr/local/bin/start-openclaw.sh

# Copy custom skills
COPY skills/ /root/clawd/skills/

# Copy swarm agent definitions
COPY agents-swarm.json /app/agents-swarm.json

# Set working directory
WORKDIR /root/clawd

# Expose the gateway port
EXPOSE 18789
