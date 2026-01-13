export const PERSONALITY_QUESTIONS = [
  {
    question: "Which sounds most like you?",
    dimension: "professionalism",
    answers: [
      {
        text: "Sharing a quick update on what we’ve been working on lately. Good progress, excited for what’s next.",
        stats: { professionalism: 3 },
      },
      {
        text: "Been working on this for a bit. Making progress, fixing stuff, feeling good about it.",
        stats: { professionalism: 6 },
      },
      {
        text: "Working on stuff. It’s moving.",
        stats: { professionalism: 9 },
      },
    ],
  },
  {
    question: "Which looks most like how you post?",
    dimension: "spacing",
    answers: [
      {
        text: "Progress comes from consistency and patience. It rarely happens all at once, but it adds up over time.",
        stats: { spacing: 2 },
      },
      {
        text: "Progress comes from consistency.\n\nIt rarely happens all at once.\n\nBut it adds up.",
        stats: { spacing: 6 },
      },
      {
        text: "Progress comes from consistency.\n\nIt adds up.",
        stats: { spacing: 9 },
      },
    ],
  },
  {
    question: "Which feels right to you?",
    dimension: "emoji_usage",
    answers: [
      {
        text: "Progress takes time and focus. Stay patient and keep going.",
        stats: { emoji_usage: 0 },
      },
      {
        text: "Progress takes time. Stay patient and keep going 💪",
        stats: { emoji_usage: 5 },
      },
      {
        text: "Progress takes time ⏳\nKeep going 🚀",
        stats: { emoji_usage: 9 },
      },
    ],
  },
  {
    question: "Which matches how you talk to people?",
    dimension: "directness",
    answers: [
      {
        text: "If you’re stuck, this might help — it worked for me.",
        stats: { directness: 3 },
      },
      {
        text: "If you’re stuck, try this. It helped me more than I expected.",
        stats: { directness: 6 },
      },
      {
        text: "If you’re stuck, do this.",
        stats: { directness: 9 },
      },
    ],
  },
  {
    question: "Which is closer to your style?",
    dimension: "brevity",
    answers: [
      {
        text: "Most progress comes from small improvements made consistently over time. It’s not exciting, but it works.",
        stats: { brevity: 3 },
      },
      {
        text: "Progress comes from small improvements made consistently. It’s not exciting — but it works.",
        stats: { brevity: 6 },
      },
      {
        text: "Small improvements.\nRepeated.",
        stats: { brevity: 9 },
      },
    ],
  },
  {
    question: "Which sounds most like your sense of humor?",
    dimension: "humor",
    answers: [
      {
        text: "Progress isn’t glamorous, but it’s real. Quiet effort adds up.",
        stats: { humor: 2 },
      },
      {
        text: "Progress isn’t glamorous… but it works. (Annoying, honestly.)",
        stats: { humor: 6 },
      },
      {
        text: "Progress is just doing the same thing forever until it finally stops being embarrassing.",
        stats: { humor: 9 },
      },
    ],
  },
];

/**
 * Convert personality stats to formatting preferences and voice hints for AI generation.
 *
 * Stats expected (string-based):
 * - spacing: 'none' | 'little' | 'lot'
 * - brevity: 'short' | 'medium' | 'long'
 * - emoji_usage: 'none' | 'some' | 'lots'
 * - professionalism: 'casual' | 'balanced' | 'professional'
 * - humor: 'none' | 'dry' | 'sarcastic' | 'playful'
 * - energy: 'calm' | 'balanced' | 'energetic'
 */
export function buildVoiceFromStats(stats) {
  // Map spacing → line_breaks
  const spacingMap = {
    none: "minimal",
    little: "moderate",
    lot: "frequent",
  };

  // Map emoji_usage → emojis
  const emojiMap = {
    none: "none",
    some: "sparse",
    lots: "moderate",
  };

  const formatting = {
    line_breaks: spacingMap[stats.spacing] || "moderate",
    emojis: emojiMap[stats.emoji_usage] || "sparse",
  };

  // Build voice hints from professionalism, energy, brevity, humor
  const voiceHints = buildVoiceHints(stats);

  return {
    formatting,
    voiceHints,
  };
}

/**
 * Build voice profile hints from personality stats.
 * Returns a pseudo-voiceProfile that can be used in AI.generatePosts()
 */
function buildVoiceHints(stats) {
  const {
    professionalism = "balanced",
    energy = "balanced",
    brevity = "medium",
    humor = "none",
  } = stats;

  // Build tone description based on professionalism
  const toneMap = {
    casual: "Casual and relaxed, like talking to a friend.",
    balanced: "Conversational and approachable, with a natural flow.",
    professional: "Professional and polished, with clear and structured language.",
  };
  const tone = toneMap[professionalism] || toneMap.balanced;

  // Build energy description
  const energyMap = {
    calm: "Calm and measured, thoughtful pacing.",
    balanced: "Balanced energy, naturally engaging.",
    energetic: "High energy and enthusiastic, punchy delivery.",
  };
  const energyDesc = energyMap[energy] || energyMap.balanced;

  // Build brevity description
  const brevityMap = {
    short: "Very concise and punchy, short sentences, minimal words.",
    medium: "Moderately concise, balancing detail with brevity.",
    long: "Uses full sentences with context and explanation.",
  };
  const brevityDesc = brevityMap[brevity] || brevityMap.medium;

  // Build humor description
  const humorMap = {
    none: "Serious and earnest tone.",
    dry: "Dry wit, understated humor.",
    sarcastic: "Sarcastic edge, sharp observations.",
    playful: "Playful and fun, not afraid to be silly.",
  };
  const humorDesc = humorMap[humor] || humorMap.none;

  // Combine into voice_summary
  const voice_summary = `${tone} ${energyDesc} ${brevityDesc} ${humorDesc}`;

  // Build sentence patterns hint based on brevity
  const sentenceMap = {
    short: "Short, punchy sentences. Fragments are fine. Get to the point fast.",
    medium: "Mix of sentence lengths. Natural rhythm.",
    long: "Full sentences with supporting details. Flowing and complete.",
  };
  const sentence_patterns = sentenceMap[brevity] || sentenceMap.medium;

  // Build tone markers
  const tone_markers = [tone, energyDesc, humorDesc].join(" ");

  return {
    voice_summary,
    sentence_patterns,
    tone_markers,
    // These fields are intentionally empty for onboarding samples
    persona_summary: null,
    vocabulary_notes: null,
    formatting_habits: null,
    hard_rules: [],
  };
}
