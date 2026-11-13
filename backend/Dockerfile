# =============================================================================
# Stage 1 — Python dependencies builder
# =============================================================================
FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Preserve the existing Playwright installation configuration.
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

RUN pip install --no-cache-dir playwright \
    && playwright install chromium


# =============================================================================
# Stage 2 — Runtime with system dependencies for the meeting bot
# =============================================================================
FROM python:3.11-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV DISPLAY=:99

# Virtual display, VNC, audio, FFmpeg, and Chrome dependencies.
RUN apt-get update && apt-get install -y \
    xvfb \
    x11-utils \
    x11vnc \
    novnc \
    websockify \
    pulseaudio \
    pulseaudio-utils \
    dbus \
    libportaudio2 \
    portaudio19-dev \
    libasound2 \
    libasound2-plugins \
    alsa-utils \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libgbm1 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    fonts-liberation \
    xdg-utils \
    wget \
    curl \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome.
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /usr/share/keyrings/google-linux.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Route ALSA audio through PulseAudio.
RUN printf 'pcm.!default {\n    type pulse\n}\nctl.!default {\n    type pulse\n}\n' \
    > /etc/asound.conf

# Copy Python dependencies, executable scripts, and Playwright browsers.
COPY --from=builder \
    /usr/local/lib/python3.11/site-packages \
    /usr/local/lib/python3.11/site-packages

COPY --from=builder /usr/local/bin /usr/local/bin

COPY --from=builder \
    /root/.cache/ms-playwright \
    /root/.cache/ms-playwright

WORKDIR /app

# Copy backend application code.
COPY . .

# Install the startup script outside /app.
# The existing Compose configuration bind-mounts the host backend over /app.
COPY start.sh /usr/local/bin/smart-mom-start

# Normalize Windows line endings, set permissions, and validate Bash syntax.
RUN sed -i 's/\r$//' /usr/local/bin/smart-mom-start \
    && chmod 0755 /usr/local/bin/smart-mom-start \
    && /bin/bash -n /usr/local/bin/smart-mom-start

EXPOSE 3014
EXPOSE 6080

CMD ["/bin/bash", "/usr/local/bin/smart-mom-start"]