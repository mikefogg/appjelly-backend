import { 
  mediaQueue, 
  JOB_PROCESS_ACTOR_IMAGE, 
  JOB_GENERATE_PAGE_IMAGE,
  JOB_GENERATE_PAGE_AUDIO,
  JOB_GENERATE_ARTIFACT_AUDIO,
  JOB_GENERATE_STORY_AUDIO
} from "#src/background/queues/index.js";

// Helper functions for adding jobs
export const queueActorImageProcessing = async (actorId, imageKey, options = {}) => {
  return await mediaQueue.add(JOB_PROCESS_ACTOR_IMAGE, {
    actorId,
    imageKey
  }, {
    priority: options.priority || 5,
    delay: options.delay || 0,
    ...options
  });
};

export const queuePageImageGeneration = async (pageId, artifactId, options = {}) => {
  console.log("🖼️ Queueing page image generation for page", pageId, "with artifact", artifactId);
  return await mediaQueue.add(JOB_GENERATE_PAGE_IMAGE, {
    pageId,
    artifactId
  }, {
    priority: options.priority || 3,
    delay: options.delay || 0,
    ...options
  });
};

// Batch queue multiple page images
export const queueBatchPageImages = async (pages, options = {}) => {
  const jobs = pages.map((page, index) => ({
    name: JOB_GENERATE_PAGE_IMAGE,
    data: {
      pageId: page.id,
      artifactId: page.artifact_id
    },
    opts: {
      priority: options.priority || 3,
      delay: (options.staggerDelay || 2000) * index, // Stagger by 2 seconds each
      ...options
    }
  }));

  return await mediaQueue.addBulk(jobs);
};

// Audio generation functions
export const queuePageAudioGeneration = async (pageId, artifactId, options = {}) => {
  console.log("🎵 Queueing page audio generation for page", pageId, "with artifact", artifactId);
  return await mediaQueue.add(JOB_GENERATE_PAGE_AUDIO, {
    pageId,
    artifactId,
    voice: options.voice || 'nova',
    speed: options.speed || 1.0
  }, {
    priority: options.priority || 3,
    delay: options.delay || 0,
    ...options
  });
};

// Batch queue multiple page audio generations
export const queueBatchPageAudio = async (pages, options = {}) => {
  const jobs = pages.map((page, index) => ({
    name: JOB_GENERATE_PAGE_AUDIO,
    data: {
      pageId: page.id,
      artifactId: page.artifact_id,
      voice: options.voice || 'nova',
      speed: options.speed || 1.0
    },
    opts: {
      priority: options.priority || 3,
      delay: (options.staggerDelay || 3000) * index, // Stagger by 3 seconds each
      ...options
    }
  }));

  return await mediaQueue.addBulk(jobs);
};

// Queue audio generation for entire artifact (individual page jobs)
export const queueArtifactAudioGeneration = async (artifactId, options = {}) => {
  console.log("🎵 Queueing artifact audio generation for artifact", artifactId);
  return await mediaQueue.add(JOB_GENERATE_ARTIFACT_AUDIO, {
    artifactId,
    voice: options.voice || 'nova',
    speed: options.speed || 1.0
  }, {
    priority: options.priority || 2,
    delay: options.delay || 0,
    ...options
  });
};

// Queue single audio generation for entire story
export const queueStoryAudioGeneration = async (artifactId, options = {}) => {
  console.log("🎵 Queueing single story audio generation for artifact", artifactId);
  return await mediaQueue.add(JOB_GENERATE_STORY_AUDIO, {
    artifactId,
    voice: options.voice || 'nova',
    speed: options.speed || 1.0
  }, {
    priority: options.priority || 1, // Higher priority since it's more efficient
    delay: options.delay || 0,
    ...options
  });
};

export default mediaQueue;