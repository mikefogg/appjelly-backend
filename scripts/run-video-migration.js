#!/usr/bin/env node

import { knex } from '#src/models/index.js';

async function runMigration() {
  try {
    console.log('Adding video fields to media table...');
    
    await knex.schema.alterTable('media', function (table) {
      // Add video-specific fields
      table.string('video_key').nullable();
      table.string('video_filename').nullable();
      table.string('video_format').nullable();
      table.integer('video_duration_seconds').nullable();
      table.bigInteger('video_size_bytes').nullable();
      table.integer('video_width').nullable();
      table.integer('video_height').nullable();
      table.integer('video_fps').nullable();
    });
    
    console.log('✅ Video fields added successfully');
  } catch (error) {
    console.error('❌ Error adding video fields:', error.message);
  } finally {
    await knex.destroy();
  }
}

runMigration();