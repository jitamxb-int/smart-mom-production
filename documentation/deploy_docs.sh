#!/bin/bash

set -e

echo "Starting documentation site deployment..."

echo "Building and starting the docs site..."
docker compose -f docker-compose.yml up -d --build --wait

echo "Cleaning up unused Docker resources..."
docker system prune -a -f

echo "Deployment completed successfully."
# To make the script executable, run: chmod +x deploy_docs.sh
# To run the script, run: bash deploy_docs.sh
