#!/bin/bash
set -e

echo "Starting deployment..."

echo "Pulling latest code..."
git pull origin main

echo "Stopping and removing old containers..."
docker compose -f docker-compose-backend.yml down

echo "Removing old image to force fresh build..."
docker rmi smart-mom-ai:latest 2>/dev/null || true

echo "Building and starting services..."
docker compose -f docker-compose-backend.yml up -d --build --wait

echo "Cleaning up..."
docker system prune -f

echo "Deployment completed successfully."