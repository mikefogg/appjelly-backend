#!/bin/bash

echo "Setting up Remotion for Fursona video generation..."

# Navigate to the Remotion directory
cd "$(dirname "$0")"

# Install dependencies
echo "Installing dependencies..."
npm install

# Create output directory
mkdir -p out

echo "Setup complete!"
echo ""
echo "To render a test video:"
echo "npm run render"
echo ""
echo "To preview in browser:"
echo "npm run preview"