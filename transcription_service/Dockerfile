# FROM nvidia/cuda:11.8.0-runtime-ubuntu22.04

# # Set system path and runtime requirements
# ENV PYTHONUNBUFFERED=1
# RUN apt-get update && apt-get install -y python3-pip ffmpeg git && rm -rf /var/lib/apt/lists/*

# WORKDIR /workspace

# # Install your heavy machine learning libraries safely
# COPY requirements.txt .
# RUN pip3 install --no-cache-dir -r requirements.txt

# COPY app/ ./app/

# EXPOSE 3000

# # Expose Uvicorn API mapping. 
# # --workers 1 is CRITICAL to keep multiple requests from overloading your GPU VRAM
# CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000", "--workers", "1"]

# For simple service 
FROM python:3.11-slim

WORKDIR /workspace

# Install system utilities needed for basic networking
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install the minimal requirements file
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the mock application code over
COPY app/ ./app/

# Expose the API port
EXPOSE 3001

# Start the mock app server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3001"]