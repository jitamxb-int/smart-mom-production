#!/bin/bash
set -e

echo "Starting deployment..."

# Check if .env file exists
if [ ! -f .env.local ]; then
    echo "❌ .env.local file not found! Please create one based on .env.example"
    exit 1
fi

echo "Pulling latest code..."

git pull origin main

echo "Building and starting services..."

docker compose -f docker-compose-frontend.yml up -d --build --wait

echo "Cleaning up..."

docker system prune -a -f

echo "Deployment completed successfully."