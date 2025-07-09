#!/usr/bin/env node

/**
 * Generate audio for all pages of an artifact
 * 
 * Usage:
 *   node scripts/generate-artifact-audio.js <artifactId> [voice] [speed]
 * 
 * Examples:
 *   node scripts/generate-artifact-audio.js 123e4567-e89b-12d3-a456-426614174000
 *   node scripts/generate-artifact-audio.js 123e4567-e89b-12d3-a456-426614174000 nova
 *   node scripts/generate-artifact-audio.js 123e4567-e89b-12d3-a456-426614174000 shimmer 0.9
 * 
 * Available voices: alloy, echo, fable, onyx, nova, shimmer, sage
 * Speed range: 0.25 to 4.0
 */

import { Artifact } from "#src/models/index.js";
import { knex } from "#src/models/index.js";
import { queueArtifactAudioGeneration } from "#src/background/queues/image-queue.js";
import chalk from "chalk";

async function main() {
  const [artifactId, voice = 'nova', speed = '1.0'] = process.argv.slice(2);

  if (!artifactId) {
    console.error(chalk.red('Error: Artifact ID is required'));
    console.log('\nUsage: node scripts/generate-artifact-audio.js <artifactId> [voice] [speed]');
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
    console.log(chalk.blue(`\n🎵 Generating audio for artifact ${artifactId}`));
    console.log(chalk.gray(`Voice: ${voice}, Speed: ${speedNum}x`));

    // Check if artifact exists
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched('[pages, account.app]');

    if (!artifact) {
      console.error(chalk.red(`Error: Artifact ${artifactId} not found`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ Found artifact: "${artifact.title}"`));
    console.log(chalk.gray(`  Account: ${artifact.account?.email || 'Unknown'}`));
    console.log(chalk.gray(`  App: ${artifact.account?.app?.name || 'Unknown'}`));
    console.log(chalk.gray(`  Pages: ${artifact.pages?.length || 0}`));

    if (!artifact.pages || artifact.pages.length === 0) {
      console.error(chalk.red('Error: Artifact has no pages'));
      process.exit(1);
    }

    // Check for pages with text - text is stored in layout_data.text as an array
    const pagesWithText = artifact.pages.filter(page => {
      if (page.layout_data && page.layout_data.text && Array.isArray(page.layout_data.text)) {
        return page.layout_data.text.length > 0 && page.layout_data.text.some(text => text.trim() !== '');
      }
      // Fallback to page.text if it exists
      return page.text && page.text.trim() !== '';
    });
    console.log(chalk.gray(`  Pages with text: ${pagesWithText.length}`));

    if (pagesWithText.length === 0) {
      console.error(chalk.red('Error: No pages have text content'));
      console.log(chalk.gray('\nDebugging first few pages:'));
      artifact.pages.slice(0, 3).forEach((page, index) => {
        console.log(chalk.gray(`  Page ${page.page_number}:`));
        console.log(chalk.gray(`    layout_data.text type: ${Array.isArray(page.layout_data?.text) ? 'Array' : typeof page.layout_data?.text}`));
        console.log(chalk.gray(`    layout_data.text length: ${page.layout_data?.text?.length || 0}`));
        console.log(chalk.gray(`    layout_data.text sample: ${JSON.stringify(page.layout_data?.text?.slice(0, 2))}`));
      });
      process.exit(1);
    }

    // Show estimated cost - extract text from layout_data.text arrays
    const totalCharacters = pagesWithText.reduce((sum, page) => {
      let pageText = '';
      if (page.layout_data && page.layout_data.text && Array.isArray(page.layout_data.text)) {
        pageText = page.layout_data.text.join(' ');
      } else if (page.text) {
        pageText = page.text;
      }
      return sum + pageText.length;
    }, 0);
    const estimatedCost = (totalCharacters * 0.015 / 1000).toFixed(4); // TTS-1 pricing
    console.log(chalk.yellow(`\n💰 Estimated cost: $${estimatedCost} (${totalCharacters} characters)`));

    // Queue the job
    console.log(chalk.blue('\n🚀 Queueing audio generation job...'));
    
    const job = await queueArtifactAudioGeneration(artifactId, {
      voice,
      speed: speedNum,
    });

    console.log(chalk.green(`\n✓ Job queued successfully!`));
    console.log(chalk.gray(`  Job ID: ${job.id}`));
    console.log(chalk.gray(`  Queue: media-processing`));
    console.log(chalk.gray(`  Status: ${job.status || 'waiting'}`));

    // Show how to monitor progress
    console.log(chalk.blue('\n📊 To monitor progress:'));
    console.log(chalk.gray('  1. Check the media worker logs'));
    console.log(chalk.gray('  2. Query the media table for audio records'));
    console.log(chalk.gray(`  3. Check the job status: ${job.id}`));

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