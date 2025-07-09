#!/bin/bash

# Test script to render a Fursona video with black background

echo "Testing Fursona video generation..."

# Set test data
IMAGE_URL="null"
AUDIO_URL="null"
TEXT="(With a dramatic sigh) Oh, the injustices of my life! I, a noble pug, watching the world go by—while I am stuck in here!"
OUTPUT_PATH="out/test-fursona.mp4"

# Create props JSON
PROPS=$(cat <<EOF
{
  "imageUrl": null,
  "audioUrl": null,
  "text": "$TEXT"
}
EOF
)

# Run Remotion render
echo "Rendering video..."
npx remotion render \
  src/index.jsx \
  FursonaVideo \
  "$OUTPUT_PATH" \
  --props="$PROPS" \
  --frames=0-299 \
  --codec=h264 \
  --pixel-format=yuv420p \
  --crf=23 \
  --audio-codec=aac \
  --audio-bitrate=128k \
  --overwrite

if [ -f "$OUTPUT_PATH" ]; then
  echo "✅ Video rendered successfully: $OUTPUT_PATH"
  ls -lh "$OUTPUT_PATH"
else
  echo "❌ Video rendering failed"
  exit 1
fi