#!/usr/bin/env node

import { knex } from '#src/models/index.js';

async function clearVideoMedia() {
  try {
    console.log('Deleting existing video media records...');
    
    const result = await knex('media')
      .where('media_type', 'video')
      .del();
    
    console.log(`✅ Deleted ${result} video media records`);
  } catch (error) {
    console.error('❌ Error deleting video media:', error.message);
  } finally {
    await knex.destroy();
  }
}

clearVideoMedia();