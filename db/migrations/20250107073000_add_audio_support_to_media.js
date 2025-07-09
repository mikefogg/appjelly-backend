export async function up(knex) {
  await knex.schema.alterTable('media', (table) => {
    // Add media type to distinguish between image and audio
    table.enum('media_type', ['image', 'audio']).defaultTo('image').notNullable();
    
    // Add audio-specific fields
    table.string('audio_key'); // For audio files stored in S3/local
    table.string('audio_filename'); // Original filename
    table.string('audio_format'); // mp3, wav, etc.
    table.integer('audio_duration_seconds'); // Duration in seconds
    table.integer('audio_size_bytes'); // File size
    table.string('audio_voice'); // Voice used (nova, echo, etc.)
    table.float('audio_speed'); // Playback speed used
    table.text('audio_text'); // Text that was converted to audio
    
    // Make image_key nullable since audio won't have it
    table.string('image_key').nullable().alter();
    
    // Add index for media type
    table.index('media_type');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('media', (table) => {
    table.dropColumn('media_type');
    table.dropColumn('audio_key');
    table.dropColumn('audio_filename');
    table.dropColumn('audio_format');
    table.dropColumn('audio_duration_seconds');
    table.dropColumn('audio_size_bytes');
    table.dropColumn('audio_voice');
    table.dropColumn('audio_speed');
    table.dropColumn('audio_text');
    
    // Make image_key required again
    table.string('image_key').notNullable().alter();
    
    table.dropIndex('media_type');
  });
}