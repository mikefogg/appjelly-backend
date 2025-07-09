#!/usr/bin/env node

/**
 * Generate audio for a single artifact page
 * 
 * Usage:
 *   node scripts/generate-page-audio.js <pageId> [voice] [speed]
 * 
 * Examples:
 *   node scripts/generate-page-audio.js 123e4567-e89b-12d3-a456-426614174000
 *   node scripts/generate-page-audio.js 123e4567-e89b-12d3-a456-426614174000 nova
 *   node scripts/generate-page-audio.js 123e4567-e89b-12d3-a456-426614174000 shimmer 0.9
 * 
 * Available voices: alloy, echo, fable, onyx, nova, shimmer, sage
 * Speed range: 0.25 to 4.0
 */

import { ArtifactPage } from "#src/models/index.js";
import { knex } from "#src/models/index.js";
import { queuePageAudioGeneration } from "#src/background/queues/image-queue.js";
import chalk from "chalk";

async function main() {
  const [pageId, voice = 'nova', speed = '1.0'] = process.argv.slice(2);

  if (!pageId) {
    console.error(chalk.red('Error: Page ID is required'));
    console.log('\nUsage: node scripts/generate-page-audio.js <pageId> [voice] [speed]');
    console.log('\nAvailable voices: alloy, echo, fable, onyx, nova, shimmer, sage');
    console.log('Speed range: 0.25 to 4.0');
    process.exit(1);
  }

  // Validate voice
  const validVoices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'sage'];
  if (!validVoices.includes(voice)) {
    console.error(chalk.red(`Error: Invalid voice "${voice}"`));
    console.log(`Available voices: ${validVoices.join(', ')}`);
    process.exit(1);
  }

  // Validate speed
  const speedNum = parseFloat(speed);
  if (isNaN(speedNum) || speedNum < 0.25 || speedNum > 4.0) {
    console.error(chalk.red(`Error: Invalid speed "${speed}"`));
    console.log('Speed must be between 0.25 and 4.0');
    process.exit(1);
  }

  try {
    console.log(chalk.blue(`\n🎵 Generating audio for page ${pageId}`));
    console.log(chalk.gray(`Voice: ${voice}, Speed: ${speedNum}x`));

    // Check if page exists
    const page = await ArtifactPage.query()
      .findById(pageId)
      .withGraphFetched('[artifact.account.app]');

    if (!page) {
      console.error(chalk.red(`Error: Page ${pageId} not found`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ Found page ${page.page_number}`));
    console.log(chalk.gray(`  Artifact: ${page.artifact?.title || 'Unknown'}`));
    console.log(chalk.gray(`  Account: ${page.artifact?.account?.email || 'Unknown'}`));
    console.log(chalk.gray(`  App: ${page.artifact?.account?.app?.name || 'Unknown'}`));

    // Extract text content - it's stored as an array of sentences in layout_data.text
    let pageText = '';
    
    if (page.layout_data && page.layout_data.text && Array.isArray(page.layout_data.text)) {
      // Join the array of sentences into a single string
      pageText = page.layout_data.text.join(' ');
    } else if (page.text && Array.isArray(page.text)) {
      // Fallback: check if page.text is also an array
      pageText = page.text.join(' ');
    } else if (typeof page.text === 'string') {
      // Fallback: use page.text if it's a string
      pageText = page.text;
    }

    // Debug: Show the text structure
    console.log(chalk.blue('\n🔍 Text structure debug:'));
    console.log(chalk.gray('  layout_data.text type:'), Array.isArray(page.layout_data?.text) ? 'Array' : typeof page.layout_data?.text);
    console.log(chalk.gray('  layout_data.text length:'), page.layout_data?.text?.length || 0);
    console.log(chalk.gray('  First few sentences:'), page.layout_data?.text?.slice(0, 3));

    if (!pageText || pageText.trim() === '') {
      console.error(chalk.red('Error: Page has no text content'));
      console.error(chalk.red('Raw layout_data.text:'), page.layout_data?.text);
      process.exit(1);
    }

    // Show text preview
    const textPreview = pageText.substring(0, 100) + (pageText.length > 100 ? '...' : '');
    console.log(chalk.gray(`  Joined text: "${textPreview}"`));
    console.log(chalk.gray(`  Total characters: ${pageText.length}`));

    // Show estimated cost
    const estimatedCost = (pageText.length * 0.015 / 1000).toFixed(4); // TTS-1 pricing
    console.log(chalk.yellow(`\n💰 Estimated cost: $${estimatedCost}`));

    // Check if audio already exists
    const existingAudio = await knex('media')
      .where({
        owner_type: 'artifact_page',
        owner_id: pageId,
        media_type: 'audio'
      })
      .first();

    if (existingAudio) {
      console.log(chalk.yellow('\n⚠️  Warning: Audio already exists for this page'));
      console.log(chalk.gray(`  Audio file: ${existingAudio.audio_filename}`));
      console.log(chalk.gray(`  Created: ${existingAudio.created_at}`));
      
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise((resolve) => {
        rl.question(chalk.yellow('\nGenerate new audio anyway? (y/N): '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.gray('\nCancelled.'));
        process.exit(0);
      }
    }

    // Queue the job
    console.log(chalk.blue('\n🚀 Queueing audio generation job...'));
    
    const job = await queuePageAudioGeneration(pageId, page.artifact_id, {
      voice,
      speed: speedNum,
    });

    console.log(chalk.green(`\n✓ Job queued successfully!`));
    console.log(chalk.gray(`  Job ID: ${job.id}`));
    console.log(chalk.gray(`  Queue: media-processing`));
    console.log(chalk.gray(`  Status: ${job.status || 'waiting'}`));

    // Show how to check result
    console.log(chalk.blue('\n📊 To check the result:'));
    console.log(chalk.gray('  1. Check the media worker logs'));
    console.log(chalk.gray(`  2. Query media table: SELECT * FROM media WHERE owner_id = '${pageId}' AND media_type = 'audio';`));
    console.log(chalk.gray(`  3. Audio will be saved to: storage/audio/`));

    console.log(chalk.green('\n✨ Done! Audio generation has been queued.\n'));

  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await knex.destroy();
  }
}

// Run the script
main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});