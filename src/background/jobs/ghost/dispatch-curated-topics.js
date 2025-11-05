/**
 * Dispatch Curated Topics Job
 * Queues sync jobs for all active curated topics with staggered delays
 * to stay under Twitter API rate limits (15 requests per 15 minutes)
 */

import { CuratedTopic } from "#src/models/index.js";
import { ghostQueue } from "#src/background/queues/index.js";
import { JOB_SYNC_CURATED_TOPIC } from "./sync-curated-topic.js";

export const JOB_DISPATCH_CURATED_TOPICS = "dispatch-curated-topics";

// Stagger delay: 90 seconds (1.5 minutes) between each sync job
// This spreads 10 jobs across 15 minutes, staying under rate limit
const STAGGER_DELAY_MS = 90 * 1000; // 90 seconds

export default async function dispatchCuratedTopics(job) {
  console.log(`[Dispatch Curated Topics] Starting dispatch...`);

  try {
    // Get all active topics that have a twitter_list_id
    const topics = await CuratedTopic.getTopicsReadyForSync();

    if (topics.length === 0) {
      console.log(`[Dispatch Curated Topics] No topics ready for sync (need twitter_list_id)`);
      return {
        success: true,
        dispatched: 0,
        message: "No topics ready for sync",
      };
    }

    console.log(`[Dispatch Curated Topics] Found ${topics.length} topics to sync`);

    // Queue each topic with staggered delay
    let dispatched = 0;

    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      const delay = i * STAGGER_DELAY_MS; // 0ms, 90s, 180s, 270s, etc.
      const scheduledTime = new Date(Date.now() + delay);

      console.log(
        `[Dispatch Curated Topics] Queueing "${topic.name}" (${topic.slug}) ` +
        `with ${delay}ms delay (runs at ${scheduledTime.toISOString()})`
      );

      await ghostQueue.add(
        JOB_SYNC_CURATED_TOPIC,
        { curatedTopicId: topic.id },
        {
          jobId: `sync-topic-${topic.id}-${Date.now()}`,
          delay,
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 60000, // Start with 1 minute, then 2min, 4min
          },
        }
      );

      dispatched++;
    }

    const totalTimeMinutes = Math.ceil((topics.length * STAGGER_DELAY_MS) / 60000);

    console.log(
      `[Dispatch Curated Topics] ✅ Dispatched ${dispatched} sync jobs ` +
      `(will complete in ~${totalTimeMinutes} minutes)`
    );

    return {
      success: true,
      dispatched,
      topics: topics.map(t => ({ id: t.id, slug: t.slug, name: t.name })),
      total_time_minutes: totalTimeMinutes,
    };

  } catch (error) {
    console.error(`[Dispatch Curated Topics] Error:`, error);
    throw error;
  }
}
