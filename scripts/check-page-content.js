#!/usr/bin/env node

/**
 * Check the content structure of an artifact page
 * 
 * Usage:
 *   node scripts/check-page-content.js <pageId>
 */

import { ArtifactPage } from "#src/models/index.js";
import { knex } from "#src/models/index.js";
import chalk from "chalk";

async function main() {
  const [pageId] = process.argv.slice(2);

  if (!pageId) {
    console.error(chalk.red('Error: Page ID is required'));
    console.log('\nUsage: node scripts/check-page-content.js <pageId>');
    process.exit(1);
  }

  try {
    console.log(chalk.blue(`\n📄 Checking page ${pageId}`));

    // Get the page
    const page = await ArtifactPage.query()
      .findById(pageId)
      .withGraphFetched('[artifact]');

    if (!page) {
      console.error(chalk.red(`Error: Page ${pageId} not found`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ Found page ${page.page_number}`));
    console.log(chalk.gray(`  Artifact: ${page.artifact?.title || 'Unknown'}`));
    console.log(chalk.gray(`  Created: ${page.created_at}`));

    // Check all text-related fields
    console.log(chalk.blue('\n📝 Text Fields:'));
    console.log(chalk.gray('  text field type:'), typeof page.text);
    console.log(chalk.gray('  text field value:'), page.text);
    
    // Check if text is JSON
    if (page.text) {
      try {
        const parsed = typeof page.text === 'string' ? JSON.parse(page.text) : page.text;
        console.log(chalk.gray('  Parsed JSON:'), JSON.stringify(parsed, null, 2));
        
        // Check for common text properties
        if (parsed.text) {
          console.log(chalk.green('  ✓ Found text property:'), parsed.text);
        }
        if (parsed.content) {
          console.log(chalk.green('  ✓ Found content property:'), parsed.content);
        }
        if (parsed.story) {
          console.log(chalk.green('  ✓ Found story property:'), parsed.story);
        }
      } catch (e) {
        console.log(chalk.yellow('  ⚠️  Not valid JSON, treating as plain text'));
      }
    }

    // Check other relevant fields
    console.log(chalk.blue('\n🎨 Other Fields:'));
    console.log(chalk.gray('  image_prompt:'), page.image_prompt);
    console.log(chalk.gray('  image_key:'), page.image_key);
    console.log(chalk.gray('  layout_data:'), page.layout_data);

    console.log(chalk.green('\n✨ Done!\n'));

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