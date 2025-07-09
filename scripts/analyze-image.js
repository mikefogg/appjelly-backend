#!/usr/bin/env node

import { Media } from "#src/models/index.js";
import imageAnalysisService from "#src/helpers/fursona/image-analysis-service.js";
import chalk from "chalk";

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(`
Usage: node scripts/analyze-image.js <mediaId> [options]

Options:
  --force          Force re-analysis even if already analyzed
  --help           Show this help message

Examples:
  node scripts/analyze-image.js 123e4567-e89b-12d3-a456-426614174000
  node scripts/analyze-image.js 123e4567-e89b-12d3-a456-426614174000 --force
  `);
  process.exit(0);
}

const mediaId = args[0];
const forceReanalysis = args.includes('--force');

async function analyzeImage() {
  try {
    console.log(chalk.blue('\n🔍 Image Analysis Script\n'));
    console.log(`Media ID: ${mediaId}`);
    console.log(`Force re-analysis: ${forceReanalysis}`);
    console.log('');

    // Step 1: Get the media object
    console.log(chalk.yellow('📋 Step 1: Loading media object...'));
    const media = await Media.query().findById(mediaId);
    
    if (!media) {
      throw new Error(`Media with ID ${mediaId} not found`);
    }

    if (media.media_type !== 'image') {
      throw new Error(`Media ${mediaId} is not an image (type: ${media.media_type})`);
    }

    if (!media.image_key) {
      throw new Error(`Media ${mediaId} does not have an image_key`);
    }

    console.log(`✓ Found image media: ${media.image_key}`);
    console.log(`  Media type: ${media.media_type}`);
    console.log(`  Owner: ${media.owner_type}/${media.owner_id}`);
    console.log(`  Status: ${media.status}`);
    console.log('');

    // Step 2: Check if already analyzed
    console.log(chalk.yellow('🔍 Step 2: Checking analysis status...'));
    const hasBeenAnalyzed = await imageAnalysisService.hasBeenAnalyzed(mediaId);
    
    if (hasBeenAnalyzed && !forceReanalysis) {
      console.log(chalk.green('✓ Image already analyzed!'));
      
      const existingResults = await imageAnalysisService.getAnalysisResults(mediaId);
      console.log(`  Description: "${existingResults.description}"`);
      console.log(`  Cost: $${existingResults.cost_usd.toFixed(6)}`);
      console.log(`  Analyzed at: ${existingResults.analyzed_at}`);
      console.log('');
      console.log(chalk.gray('Use --force to re-analyze'));
      return;
    }

    if (hasBeenAnalyzed && forceReanalysis) {
      console.log(chalk.yellow('⚠️  Image already analyzed, but forcing re-analysis...'));
    } else {
      console.log(chalk.green('✓ Image not yet analyzed, proceeding...'));
    }
    console.log('');

    // Step 3: Analyze the image
    console.log(chalk.yellow('🤖 Step 3: Analyzing image with GPT-4 Vision...'));
    const startTime = Date.now();
    
    const analysisResult = await imageAnalysisService.analyzeImageMedia(media);
    
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;

    console.log('');
    console.log(chalk.green('✅ Analysis completed successfully!'));
    console.log('');

    // Step 4: Display results
    console.log(chalk.blue('📊 Analysis Results:'));
    console.log('');
    console.log(chalk.white.bold('Description:'));
    console.log(`  ${analysisResult.description}`);
    console.log('');
    
    console.log(chalk.white.bold('Cost Information:'));
    console.log(`  Total Cost: ${chalk.green('$' + analysisResult.cost.toFixed(6))}`);
    console.log(`  Input Tokens: ${analysisResult.token_usage.prompt_tokens}`);
    console.log(`  Output Tokens: ${analysisResult.token_usage.completion_tokens}`);
    console.log(`  Total Tokens: ${analysisResult.token_usage.total_tokens}`);
    console.log('');
    
    console.log(chalk.white.bold('Processing Information:'));
    console.log(`  Model: ${analysisResult.model}`);
    console.log(`  Provider: ${analysisResult.provider}`);
    console.log(`  Processing Time: ${analysisResult.processing_time.toFixed(2)}s`);
    console.log(`  Total Time: ${totalTime.toFixed(2)}s`);
    console.log('');

    // Step 5: Verification
    console.log(chalk.yellow('✅ Step 4: Verifying saved results...'));
    const savedResults = await imageAnalysisService.getAnalysisResults(mediaId);
    
    if (savedResults) {
      console.log(chalk.green('✓ Analysis results saved to database'));
      console.log(`  Saved at: ${savedResults.analyzed_at}`);
    } else {
      console.log(chalk.red('❌ Failed to save analysis results'));
    }
    console.log('');

    console.log(chalk.blue('🎉 Image analysis complete!'));

  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
analyzeImage().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});