#!/bin/bash

set -e

echo "Starting deployment..."
# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found! Please create one based on .env.example"
    exit 1
fi


echo "Pulling latest code..."
git pull origin main

echo "Building and starting services..."
docker compose -f docker-compose-backend.yml up -d --build --wait

echo "Cleaning up unused Docker resources..."
docker system prune -a -f

echo "Deployment completed successfully."
# sed -i 's/\r$//' deploy_backend.sh
# To make the script executable, run: chmod +x deploy_backend.sh
# To run the script, run: bash deploy_backend.sh