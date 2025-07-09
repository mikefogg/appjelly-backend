#!/usr/bin/env node

import { Artifact, App, Input, Actor, Media } from "#src/models/index.js";
import fursonaPetVoiceService from "#src/helpers/fursona/pet-inner-voice-service.js";
import fursonaAudioService from "#src/helpers/fursona/audio-generation-service.js";
import fursonaVideoService from "#src/helpers/fursona/video-generation-service.js";
import chalk from "chalk";

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log(`
Usage: node scripts/generate-fursona-content.js <artifactId> [options]

Options:
  --skip-audio     Skip audio generation
  --skip-video     Skip video generation
  --reset          Force regeneration of all content
  --regen-text     Force regeneration of monologue text only
  --help           Show this help message

Example:
  node scripts/generate-fursona-content.js 123e4567-e89b-12d3-a456-426614174000
  `);
  process.exit(0);
}

const artifactId = args[0];
const skipAudio = args.includes('--skip-audio');
const skipVideo = args.includes('--skip-video');
const resetContent = args.includes('--reset');
const regenText = args.includes('--regen-text');

async function generateFursonaContent() {
  try {
    console.log(chalk.blue('\n🐾 Starting Fursona Content Generation Pipeline\n'));
    console.log(`Artifact ID: ${artifactId}`);
    console.log(`Skip Audio: ${skipAudio}`);
    console.log(`Skip Video: ${skipVideo}`);
    console.log(`Reset Content: ${resetContent}`);
    console.log(`Regenerate Text: ${regenText}`);
    console.log('');

    // Step 1: Get the artifact with all relations
    console.log(chalk.yellow('📋 Step 1: Loading artifact...'));
    const artifact = await Artifact.query()
      .findById(artifactId)
      .withGraphFetched('[input, actors, app]');
      
    // Get media separately
    let artifactMedia = [];
    let inputMedia = [];
    if (artifact) {
      artifactMedia = await Media.query()
        .where('owner_type', 'artifact')
        .where('owner_id', artifactId);
      
      if (artifact.input) {
        inputMedia = await Media.query()
          .where('owner_type', 'input')
          .where('owner_id', artifact.input.id);
      }
      
      // Combine media for easier access
      artifact.media = [...artifactMedia, ...inputMedia];
    }

    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found`);
    }

    console.log(`✓ Found artifact: ${artifact.title || 'Untitled'}`);
    console.log(`  App: ${artifact.app?.slug}`);
    console.log(`  Status: ${artifact.status}`);
    console.log(`  Input: "${artifact.input?.prompt?.substring(0, 50)}..."`);
    console.log(`  Actors: ${artifact.actors?.map(a => a.name).join(', ')}`);
    console.log('');

    // Step 2: Generate pet monologue text (if not already done or forced regen)
    let monologueText = artifact.metadata?.monologue_text || artifact.description;
    
    if (!monologueText || artifact.status !== 'completed' || regenText || resetContent) {
      console.log(chalk.yellow('💭 Step 2: Generating pet inner monologue...'));
      
      const generationResult = await fursonaPetVoiceService.generateMonologueFromInput(
        artifact.input,
        artifact.actors
      );

      console.log(`✓ Generated monologue (${generationResult.monologue.length} chars)`);
      console.log(chalk.gray(`  Preview: "${generationResult.monologue.substring(0, 100)}..."`));
      console.log(`  Tokens: ${generationResult.usage.total}`);
      console.log(`  Cost: $${generationResult.cost.toFixed(4)}`);
      
      // Save to artifact (without auto-queueing audio)
      await fursonaPetVoiceService.saveMonologueToArtifact(
        artifactId,
        generationResult,
        null,
        { skipAudioGeneration: true }
      );

      monologueText = generationResult.monologue;
      console.log('✓ Saved monologue to artifact');
      console.log('');
    } else {
      console.log(chalk.green('✓ Step 2: Monologue already exists'));
      console.log(chalk.gray(`  Preview: "${monologueText.substring(0, 100)}..."`));
      console.log('');
    }

    // Step 3: Generate audio
    let audioMedia = artifact.media?.find(m => m.media_type === 'audio');
    
    // Delete existing audio if reset flag is set
    if (resetContent && audioMedia) {
      console.log(chalk.yellow('🗑️  Deleting existing audio for reset...'));
      await Media.query().deleteById(audioMedia.id);
      audioMedia = null;
    }
    
    if (!skipAudio && !audioMedia) {
      console.log(chalk.yellow('🎵 Step 3: Generating Italian chef audio...'));
      
      const audioResult = await fursonaAudioService.generateMonologueAudio(
        monologueText,
        { speed: 1.0 }
      );

      console.log(`✓ Generated audio: ${audioResult.filename}`);
      console.log(`  Size: ${(audioResult.audio_size_bytes / 1024).toFixed(2)} KB`);
      console.log(`  Cost: $${audioResult.generation_cost.toFixed(4)}`);
      console.log(`  Voice: ${audioResult.voice} (${audioResult.voice_preset})`);

      // Create media record
      audioMedia = await Media.createAudioForArtifact(artifactId, audioResult, {
        artifact_id: artifactId,
        app_slug: 'fursona',
        content_type: 'pet_monologue',
        title: artifact.title,
        voice_preset: audioResult.voice_preset,
        instructions_used: audioResult.instructions_used,
      });

      console.log(`✓ Created audio media record: ${audioMedia.id}`);
      console.log('');
    } else if (skipAudio) {
      console.log(chalk.gray('⏭️  Step 3: Skipping audio generation (--skip-audio)'));
      console.log('');
    } else {
      console.log(chalk.green('✓ Step 3: Audio already exists'));
      console.log(`  Media ID: ${audioMedia.id}`);
      console.log(`  Filename: ${audioMedia.metadata?.filename}`);
      console.log('');
    }

    // Step 4: Generate video
    if (!skipVideo && audioMedia) {
      let videoMedia = artifact.media?.find(m => m.media_type === 'video');
      
      // Delete existing video if reset flag is set
      if (resetContent && videoMedia) {
        console.log(chalk.yellow('🗑️  Deleting existing video for reset...'));
        await Media.query().deleteById(videoMedia.id);
        videoMedia = null;
      }
      
      if (!videoMedia) {
        console.log(chalk.yellow('🎬 Step 4: Generating vertical video...'));
        
        // Get the first image media
        let imageMedia = artifact.media?.find(m => m.media_type === 'image');
        let imageUrl = null;
        
        if (!imageMedia) {
          // Check if there's an image in the input's media
          const inputMedia = await Media.query()
            .where('owner_type', 'input')
            .where('owner_id', artifact.input.id)
            .where('media_type', 'image')
            .first();
            
          if (inputMedia) {
            imageMedia = inputMedia;
            imageUrl = await fursonaVideoService.getCloudflareImageUrl(imageMedia.image_key);
          } else {
            // No image found - use black background
            console.log('  No image found - using black background with text');
            imageUrl = null; // Will be handled by Remotion component
          }
        } else {
          imageUrl = await fursonaVideoService.getCloudflareImageUrl(imageMedia.image_key);
        }

        const audioFilePath = audioMedia.metadata?.file_path || 
          (audioMedia.audio_filename ? `/Users/mfogg/sites/mobile/backend/storage/audio/fursona/${audioMedia.audio_filename}` : null);

        console.log(`  Image: ${imageMedia ? imageMedia.image_key : 'none (black background)'}`);
        console.log(`  Audio: ${audioMedia.metadata?.filename}`);
        console.log(`  Text: ${monologueText.substring(0, 50)}...`);
        console.log('  Rendering with Remotion...');

        // Generate R2 URL from audio_key if available
        const audioUrl = audioMedia?.audio_key 
          ? `${process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/['";]/g, '')}/${audioMedia.audio_key}`
          : null;

        const videoResult = await fursonaVideoService.generateVideo({
          artifactId,
          imageUrl,
          audioFilePath,
          audioUrl,
          text: monologueText,
          durationInSeconds: audioMedia?.audio_duration_seconds || 10,
          audioDurationSeconds: audioMedia?.audio_duration_seconds || null,
        });

        console.log(`✓ Generated video: ${videoResult.filename}`);
        console.log(`  Size: ${(videoResult.size_bytes / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Duration: ${videoResult.duration_seconds}s`);
        console.log(`  Resolution: ${videoResult.width}x${videoResult.height}`);
        console.log(`  Generation time: ${videoResult.generation_time.toFixed(2)}s`);

        // Create media record
        videoMedia = await Media.query().insert({
          owner_type: 'artifact',
          owner_id: artifactId,
          media_type: 'video',
          video_key: videoResult.r2_key, // Use R2 key instead of filename
          video_filename: videoResult.filename,
          video_format: 'mp4',
          video_duration_seconds: videoResult.duration_seconds,
          video_size_bytes: videoResult.size_bytes,
          video_width: videoResult.width,
          video_height: videoResult.height,
          video_fps: videoResult.fps,
          metadata: {
            ...videoResult,
            app_slug: 'fursona',
            content_type: 'pet_monologue',
            title: artifact.title,
            source_image_id: imageMedia?.id || null,
            source_audio_id: audioMedia.id,
            monologue_preview: monologueText.substring(0, 100),
            // Store timing metadata
            timing_metadata: videoResult.timing_data?.metadata || null,
            // Store R2 info
            r2_key: videoResult.r2_key,
            r2_url: videoResult.r2_url,
          },
          status: 'committed',
        });

        console.log(`✓ Created video media record: ${videoMedia.id}`);
        
        // Update audio media record with timing key and actual duration if available
        if (videoResult.timing_data?.key && audioMedia) {
          const actualDuration = videoResult.timing_data.metadata?.duration_seconds;
          const updateData = {
            audio_timing_key: videoResult.timing_data.key,
            metadata: {
              ...audioMedia.metadata,
              timing_generation_cost: videoResult.timing_data.metadata?.api_cost_usd || 0,
              timing_processing_time: videoResult.timing_data.metadata?.processing_time_seconds || 0,
              timing_model: videoResult.timing_data.metadata?.model || 'unknown',
              timing_provider: videoResult.timing_data.metadata?.provider || 'unknown',
            }
          };
          
          // Update actual audio duration if we have it from Whisper
          if (actualDuration && actualDuration > 0) {
            updateData.audio_duration_seconds = Math.round(actualDuration);
            console.log(`✓ Updating audio duration from ${audioMedia.audio_duration_seconds}s to ${actualDuration}s (from Whisper)`);
          }
          
          await Media.query()
            .findById(audioMedia.id)
            .patch(updateData);
          
          console.log(`✓ Updated audio media record with timing key: ${videoResult.timing_data.key}`);
          console.log(`  Timing generation cost: $${videoResult.timing_data.metadata?.api_cost_usd?.toFixed(4) || '0.0000'}`);
        }

        // Update artifact metadata
        await artifact.$query().patch({
          metadata: {
            ...artifact.metadata,
            has_video: true,
            video_media_id: videoMedia.id,
            video_generated_at: new Date().toISOString(),
          },
        });

        console.log('✓ Updated artifact metadata');
        console.log('');
      } else {
        console.log(chalk.green('✓ Step 4: Video already exists'));
        console.log(`  Media ID: ${videoMedia.id}`);
        console.log(`  Filename: ${videoMedia.video_key}`);
        console.log('');
      }
    } else if (skipVideo) {
      console.log(chalk.gray('⏭️  Step 4: Skipping video generation (--skip-video)'));
      console.log('');
    } else if (!audioMedia) {
      console.log(chalk.gray('⏭️  Step 4: Skipping video generation (no audio available)'));
      console.log('');
    }

    // Summary
    console.log(chalk.blue('\n✨ Fursona Content Generation Complete!\n'));
    
    const updatedArtifact = await Artifact.query()
      .findById(artifactId);
      
    // Get final media
    const finalMedia = await Media.query()
      .where('owner_type', 'artifact')
      .where('owner_id', artifactId);
    
    console.log('Generated content:');
    console.log(`  📝 Monologue: ${monologueText.length} characters`);
    
    const finalAudioMedia = finalMedia.find(m => m.media_type === 'audio');
    if (finalAudioMedia) {
      console.log(`  🎵 Audio: ${finalAudioMedia.metadata?.filename} (${finalAudioMedia.id})`);
    }
    
    const finalVideoMedia = finalMedia.find(m => m.media_type === 'video');
    if (finalVideoMedia) {
      console.log(`  🎬 Video: ${finalVideoMedia.video_key} (${finalVideoMedia.id})`);
    }
    
    console.log('');
    console.log(chalk.green('All done! 🎉'));

  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
generateFursonaContent().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});