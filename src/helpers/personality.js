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
 * Stats expected:
 * - professionalism: 3/6/9 (formal → casual)
 * - spacing: 2/6/9 → line_breaks (minimal/moderate/frequent)
 * - emoji_usage: 0/5/9 → emojis (none/sparse/moderate)
 * - directness: 3/6/9 (soft → direct)
 * - brevity: 3/6/9 (verbose → brief)
 * - humor: 2/6/9 (serious → humorous)
 */
export function buildVoiceFromStats(stats) {
  // Map spacing → line_breaks (use nearest value)
  const spacingToLineBreaks = (spacing) => {
    if (spacing <= 3) return "minimal";
    if (spacing <= 7) return "moderate";
    return "frequent";
  };

  // Map emoji_usage → emojis
  const emojiToSetting = (emoji) => {
    if (emoji === 0) return "none";
    if (emoji <= 5) return "sparse";
    return "moderate";
  };

  const formatting = {
    line_breaks: spacingToLineBreaks(stats.spacing || 6),
    emojis: emojiToSetting(stats.emoji_usage ?? 5),
  };

  // Build voice hints from professionalism, directness, brevity, humor
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
  const { professionalism = 6, directness = 6, brevity = 6, humor = 6 } = stats;

  // Build tone description based on professionalism
  let tone;
  if (professionalism <= 3) {
    tone = "Professional and polished, with clear and structured language.";
  } else if (professionalism <= 6) {
    tone = "Conversational and approachable, with a natural flow.";
  } else {
    tone = "Casual and relaxed, like talking to a friend.";
  }

  // Build directness description
  let directnessDesc;
  if (directness <= 3) {
    directnessDesc = "Soft and suggestive, using phrases like 'might help' or 'could try'.";
  } else if (directness <= 6) {
    directnessDesc = "Balanced and clear, straightforward but not pushy.";
  } else {
    directnessDesc = "Direct and confident, getting straight to the point.";
  }

  // Build brevity description
  let brevityDesc;
  if (brevity <= 3) {
    brevityDesc = "Uses full sentences with context and explanation.";
  } else if (brevity <= 6) {
    brevityDesc = "Moderately concise, balancing detail with brevity.";
  } else {
    brevityDesc = "Very concise and punchy, short sentences, minimal words.";
  }

  // Build humor description
  let humorDesc;
  if (humor <= 3) {
    humorDesc = "Serious and earnest tone.";
  } else if (humor <= 6) {
    humorDesc = "Light touches of wit or self-awareness.";
  } else {
    humorDesc = "Playful and humorous, not afraid to be self-deprecating.";
  }

  // Combine into voice_summary
  const voice_summary = `${tone} ${directnessDesc} ${brevityDesc} ${humorDesc}`;

  // Build sentence patterns hint
  let sentence_patterns;
  if (brevity >= 7) {
    sentence_patterns = "Short, punchy sentences. Fragments are fine. Get to the point fast.";
  } else if (brevity <= 3) {
    sentence_patterns = "Full sentences with supporting details. Flowing and complete.";
  } else {
    sentence_patterns = "Mix of sentence lengths. Natural rhythm.";
  }

  // Build tone markers
  const tone_markers = [tone, directnessDesc, humorDesc].join(" ");

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
