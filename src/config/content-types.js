/**
 * Content Type Rotation Configuration
 * Defines the 8 content types for optimal Twitter/X algorithm performance
 */

export const CONTENT_TYPES = [
  {
    key: 'story',
    name: 'Story / Case Study',
    description: 'Builds trust through narrative',
    prompt_guidance: 'Tell a story about how you got there. Use narrative structure with beginning, middle, end. Make it relatable and personal.',
    next_prompt: 'Yesterday was a win post. Today, tell a story about how you got there.',
    position: 1,
    icon: '📖'
  },
  {
    key: 'lesson',
    name: 'Lesson / Framework',
    description: 'Teaches something actionable',
    prompt_guidance: 'Break down a lesson or framework. Use numbered steps or bullet points. Make it actionable and clear. Focus on the "how".',
    next_prompt: 'Yesterday was a story. Today, break down the lesson you learned.',
    position: 2,
    icon: '🎓'
  },
  {
    key: 'question',
    name: 'Question / Poll',
    description: 'Drives engagement and replies',
    prompt_guidance: 'Ask a thought-provoking question. Make it easy to answer in one line. Spark discussion. Avoid yes/no questions.',
    next_prompt: 'Yesterday was a teaching post. Today, ask your audience what they think.',
    position: 3,
    icon: '❓'
  },
  {
    key: 'proof',
    name: 'Result / Proof',
    description: 'Shows momentum and credibility',
    prompt_guidance: 'Share a result, milestone, or metric. Include numbers or concrete evidence. Show progress without bragging.',
    next_prompt: 'Yesterday was a question. Today, show a result or milestone that backs it up.',
    position: 4,
    icon: '📊'
  },
  {
    key: 'opinion',
    name: 'Opinion / Hot Take',
    description: 'Sparks debate and reach',
    prompt_guidance: 'Share a bold opinion or contrarian thought. Be confident and clear. No hedging with "maybe" or "might". Make people react.',
    next_prompt: 'Yesterday was proof. Today, share a bold opinion or contrarian thought.',
    position: 5,
    icon: '🔥'
  },
  {
    key: 'personal',
    name: 'Behind the Scenes / Personal',
    description: 'Humanizes you',
    prompt_guidance: 'Show what\'s going on behind the curtain. Share personal insights, struggles, or process. Be vulnerable and authentic.',
    next_prompt: 'Yesterday was a take. Today, show what\'s going on behind the curtain.',
    position: 6,
    icon: '👤'
  },
  {
    key: 'vision',
    name: 'Vision / Prediction',
    description: 'Inspires and leads',
    prompt_guidance: 'Talk about the future and where things are headed. Be inspirational and forward-looking. Paint a picture of what\'s possible.',
    next_prompt: 'Yesterday was personal. Today, talk about the future — where things are headed.',
    position: 7,
    icon: '🔮'
  },
  {
    key: 'cta',
    name: 'Announcement / CTA',
    description: 'Converts attention into growth',
    prompt_guidance: 'Invite people to join, follow, or try something. Include clear call-to-action. Make it easy to take the next step.',
    next_prompt: 'Yesterday was a vision post. Today, invite people to join, follow, or try something.',
    position: 8,
    icon: '📢'
  }
];

/**
 * Get the next content type in rotation
 * @param {string|null} currentType - The current content type key
 * @returns {object} The next content type object
 */
export function getNextContentType(currentType) {
  if (!currentType) {
    return CONTENT_TYPES[0]; // Start with story
  }

  const currentIndex = CONTENT_TYPES.findIndex(t => t.key === currentType);

  // If not found or at the end, start over
  if (currentIndex === -1 || currentIndex === CONTENT_TYPES.length - 1) {
    return CONTENT_TYPES[0];
  }

  const nextIndex = (currentIndex + 1) % CONTENT_TYPES.length;
  return CONTENT_TYPES[nextIndex];
}

/**
 * Get content type by key
 * @param {string} key - The content type key
 * @returns {object|null} The content type object or null
 */
export function getContentTypeByKey(key) {
  return CONTENT_TYPES.find(t => t.key === key) || null;
}

/**
 * Get all content types as a simple array for API responses
 * @returns {Array} Array of content type objects
 */
export function getAllContentTypes() {
  return CONTENT_TYPES;
}

/**
 * Get next N content types in rotation sequence
 * @param {string|null} currentType - The current content type key (null for start of rotation)
 * @param {number} count - Number of content types to get
 * @returns {Array} Array of next content type objects in rotation order
 */
export function getContentTypeSequence(currentType, count = 3) {
  const sequence = [];
  let current = currentType;

  for (let i = 0; i < count; i++) {
    const next = getNextContentType(current);
    sequence.push(next);
    current = next.key;
  }

  return sequence;
}
