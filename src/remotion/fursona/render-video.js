#!/usr/bin/env node

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import express from 'express';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to get audio duration using ffprobe
function getAudioDuration(audioPath) {
  try {
    const output = execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`, { encoding: 'utf8' });
    return parseFloat(output.trim());
  } catch (error) {
    console.warn(`Could not get audio duration: ${error.message}`);
    return null;
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '');
  const value = args[i + 1];
  options[key] = value;
}

// Validate required arguments
if (!options.image || !options.text) {
  console.error('Usage: node render-video.js --image <imageUrl> --text "<monologue>" [--audio <audioPath>] [--output <outputPath>]');
  process.exit(1);
}

// Set defaults
const imageUrl = options.image === 'null' ? null : options.image;
const text = options.text;
const outputPath = options.output || path.join(__dirname, 'out', `fursona-${Date.now()}.mp4`);
let duration = parseInt(options.duration || '10');

// Set up audio URL 
let audioUrl = null;
let server = null;

// Check if audio URL is provided directly (from R2)
if (options['audio-url']) {
  audioUrl = options['audio-url'];
  console.log(`🎵 Using R2 audio URL: ${audioUrl}`);
} else if (options.audio) {
  // Fallback to local file serving
  const audioPath = path.resolve(options.audio);
  if (fs.existsSync(audioPath)) {
    // Get actual audio duration and use it for video duration
    const audioDuration = getAudioDuration(audioPath);
    if (audioDuration) {
      duration = Math.ceil(audioDuration); // Round up to nearest second
      console.log(`🎵 Audio duration: ${audioDuration.toFixed(2)}s, using ${duration}s for video`);
    }
    
    const app = express();
    app.use('/audio', express.static(path.dirname(audioPath)));
    
    server = createServer(app);
    const port = 3456; // Use a specific port for audio serving
    server.listen(port);
    
    const audioFilename = path.basename(audioPath);
    audioUrl = `http://localhost:${port}/audio/${audioFilename}`;
    
    console.log(`🎵 Serving audio at: ${audioUrl}`);
  }
}

// Word timings will be fetched by the Remotion component via props
// No need to fetch here since we're passing the URL through props

// Prepare props - sanitize text to remove newlines that break shell commands
const props = {
  imageUrl,
  audioUrl,
  text: text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(), // Remove newlines and normalize whitespace
  durationInSeconds: duration,
  wordTimingsUrl: options['word-timings-url'] || null,
};

// Build render command
const command = [
  'npx remotion render',
  'src/index.jsx',
  'FursonaVideo',
  outputPath,
  `--props='${JSON.stringify(props)}'`,
  `--frames=0-${duration * 30 - 1}`, // 30 fps
  '--codec=h264',
  '--pixel-format=yuv420p',
  '--crf=23',
  '--audio-codec=aac',
  '--audio-bitrate=128k',
  '--overwrite',
].join(' ');

console.log('🎬 Rendering Fursona video...');
console.log(`📸 Image: ${imageUrl}`);
console.log(`💬 Text: ${text.substring(0, 50)}...`);
console.log(`🎵 Audio: ${audioUrl || 'none'}`);
console.log(`⏱️  Duration: ${duration} seconds`);
console.log(`🎞️  Total frames: ${duration * 30} (${duration}s × 30fps)`);
console.log(`📁 Output: ${outputPath}`);
console.log(`🔧 Command: ${command}`);
console.log('');

try {
  // Execute render
  execSync(command, {
    cwd: __dirname,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  // Check if file was created
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    console.log('');
    console.log('✅ Video rendered successfully!');
    console.log(`📊 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📍 Location: ${outputPath}`);
  } else {
    console.error('❌ Video file was not created');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error rendering video:', error.message);
  process.exit(1);
} finally {
  // Clean up the HTTP server
  if (server) {
    server.close();
    console.log('🛑 Stopped audio server');
  }
}