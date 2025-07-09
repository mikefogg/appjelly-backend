#!/usr/bin/env node

import { knex } from '#src/models/index.js';

async function updateConstraint() {
  try {
    console.log('Updating media_type check constraint to include video...');
    
    // Drop the existing check constraint
    await knex.raw('ALTER TABLE media DROP CONSTRAINT IF EXISTS media_media_type_check');
    
    // Add new constraint that includes video
    await knex.raw(`ALTER TABLE media ADD CONSTRAINT media_media_type_check CHECK (media_type IN ('image', 'audio', 'video'))`);
    
    console.log('✅ Media type constraint updated successfully');
  } catch (error) {
    console.error('❌ Error updating constraint:', error.message);
  } finally {
    await knex.destroy();
  }
}

updateConstraint();