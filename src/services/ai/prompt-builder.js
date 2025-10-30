/**
 * Shared Prompt Builder
 * Builds AI prompts with consistent voice, samples, and rules across all generation types
 */

class PromptBuilder {
  /**
   * Build the content style section (voice, samples, rules)
   * This is the shared logic used by all AI generation
   */
  buildContentStyleSection(voice, samplePosts, rules) {
    let prompt = '';

    // CRITICAL: Voice and samples come FIRST and are the highest priority
    const hasVoice = voice && voice.trim().length > 0;
    const hasSamples = samplePosts && samplePosts.length > 0;

    if (hasVoice || hasSamples) {
      prompt += `\n\n🎯 CRITICAL - YOUR #1 PRIORITY:`;

      if (hasVoice) {
        prompt += `\n\nYou MUST write in this exact voice and style:
${voice}

This voice is non-negotiable. Every word must reflect this style.`;
      }

      if (hasSamples) {
        prompt += `\n\nYou MUST match the tone, style, and patterns from these example posts:`;
        samplePosts.forEach((sample, index) => {
          prompt += `\n\nExample ${index + 1}:
"${sample.content}"`;
          if (sample.notes) {
            prompt += `\n→ Key insight: ${sample.notes}`;
          }
        });
        prompt += `\n\nStudy these examples carefully. Copy the voice, rhythm, word choice, and personality. This is your PRIMARY instruction.`;
      }

      prompt += `\n\nIf there is ANY conflict between these voice instructions and the guidelines below, ALWAYS prioritize matching the voice and examples above.`;
    }

    // Add rules (high priority constraints)
    if (rules && rules.length > 0) {
      prompt += `\n\n⚠️ IMPORTANT RULES - You must follow these:`;

      // Group rules by type for better organization
      const rulesByType = rules.reduce((acc, rule) => {
        if (!acc[rule.rule_type]) acc[rule.rule_type] = [];
        acc[rule.rule_type].push(rule);
        return acc;
      }, {});

      // Never rules (highest priority)
      if (rulesByType.never) {
        prompt += `\n\n❌ NEVER:`;
        rulesByType.never.forEach(rule => {
          prompt += `\n- ${rule.content}`;
        });
      }

      // Always rules
      if (rulesByType.always) {
        prompt += `\n\n✅ ALWAYS:`;
        rulesByType.always.forEach(rule => {
          prompt += `\n- ${rule.content}`;
        });
      }

      // Prefer rules
      if (rulesByType.prefer) {
        prompt += `\n\n💡 PREFER:`;
        rulesByType.prefer.forEach(rule => {
          prompt += `\n- ${rule.content}`;
        });
      }

      // Tone rules
      if (rulesByType.tone) {
        prompt += `\n\n🎭 TONE:`;
        rulesByType.tone.forEach(rule => {
          prompt += `\n- ${rule.content}`;
        });
      }
    }

    return prompt;
  }

  /**
   * Build writing style fallback section
   * Only used when no voice or samples are provided
   */
  buildWritingStyleFallback(writingStyle, hasVoice, hasSamples) {
    if (!writingStyle || hasVoice || hasSamples) {
      return '';
    }

    let prompt = `\n\n📊 Writing Style Analysis:
- Tone: ${writingStyle.tone || "casual and conversational"}
- Typical length: ${writingStyle.avg_length || "medium"} characters
- Style: ${writingStyle.style_summary || "Natural and authentic"}`;

    if (writingStyle.emoji_frequency > 0.5) {
      prompt += "\n- Often uses emojis";
    }

    if (writingStyle.hashtag_frequency > 0.3) {
      prompt += "\n- Sometimes includes relevant hashtags";
    }

    if (writingStyle.common_phrases && writingStyle.common_phrases.length > 0) {
      prompt += `\n- Frequently uses phrases like: ${writingStyle.common_phrases.slice(0, 3).join(", ")}`;
    }

    return prompt;
  }

  /**
   * Build complete system prompt for manual post generation
   */
  buildManualPostSystemPrompt(platform, maxLength, voice, samplePosts, rules, writingStyle) {
    const platformName = platform === "ghost" ? "social media" : platform;

    let prompt = `You are an expert social media ghostwriter creating ${platformName} posts.`;

    // Add shared content style section
    prompt += this.buildContentStyleSection(voice, samplePosts, rules);

    // General guidelines (secondary priority)
    prompt += `\n\n📋 General Guidelines:
- Maximum ${maxLength} characters (strict limit)
- Be authentic and human - avoid corporate/marketing language
- Use line breaks to create natural paragraphs for readability and impact
- Don't force hashtags or emojis unless they match the voice above
- Make it engaging and conversational
- Write in a way that invites discussion`;

    // Add writing style as fallback
    const hasVoice = voice && voice.trim().length > 0;
    const hasSamples = samplePosts && samplePosts.length > 0;
    prompt += this.buildWritingStyleFallback(writingStyle, hasVoice, hasSamples);

    prompt += `\n\n⚠️ FORMATTING REQUIREMENTS:
- Use line breaks (newlines) to separate ideas and create natural paragraphs
- Line breaks add emphasis, readability, and impact - use them liberally
- Most posts should have 2-4 short paragraphs, not one dense block
- Example format:
  Opening thought or hook

  Supporting point or expansion

  Closing statement or call-to-action

Return ONLY the post content. No explanations, no meta-commentary, no quotation marks around the post. Just the raw post text with natural line breaks.`;

    return prompt;
  }

  /**
   * Build complete system prompt for suggestion generation
   */
  buildSuggestionSystemPrompt(platform, voice, samplePosts, rules, writingStyle) {
    const platformName = platform === "ghost" ? "social media" : platform;

    let prompt = `You are a social media ghostwriter that creates engaging ${platformName} post suggestions.`;

    // Add shared content style section
    prompt += this.buildContentStyleSection(voice, samplePosts, rules);

    // Add writing style as fallback
    const hasVoice = voice && voice.trim().length > 0;
    const hasSamples = samplePosts && samplePosts.length > 0;
    prompt += this.buildWritingStyleFallback(writingStyle, hasVoice, hasSamples);

    prompt += `\n\nYour goal is to suggest posts that will get high engagement and match the user's authentic voice.`;

    // Formatting requirements
    prompt += `\n\n⚠️ FORMATTING REQUIREMENTS:
- Use line breaks (newlines) to separate ideas and create natural paragraphs
- Line breaks add emphasis, readability, and impact - use them liberally
- Most posts should have 2-4 short paragraphs, not one dense block
- Example format:
  Opening thought or hook

  Supporting point or expansion

  Closing statement or call-to-action`;

    // JSON format instructions
    prompt += `\n\nReturn suggestions as JSON:
{
  "suggestions": [
    {
      "content": "The post text with natural line breaks",
      "reasoning": "Why this will resonate",
      "angle": "hot_take|roast|hype|story|teach|question",
      "length": "short|medium|long",
      "topics": ["topic1", "topic2"],
      "inspired_by_posts": [0, 3] // Optional: indices of posts that inspired this
    }
  ]
}`;

    return prompt;
  }

  /**
   * Build complete system prompt for interest-based suggestions
   */
  buildInterestBasedSystemPrompt(platform, voice, samplePosts, rules) {
    const platformName = platform === "ghost" ? "social media" : platform;

    let prompt = `You are a social media ghostwriter that creates engaging ${platformName} post suggestions based on the user's interests.`;

    // Add shared content style section
    prompt += this.buildContentStyleSection(voice, samplePosts, rules);

    prompt += `\n\nYour goal is to suggest posts that:
1. Match the user's voice perfectly (top priority)
2. Align with their stated interests
3. Will get high engagement and start conversations`;

    // Formatting requirements
    prompt += `\n\n⚠️ FORMATTING REQUIREMENTS:
- Use line breaks (newlines) to separate ideas and create natural paragraphs
- Line breaks add emphasis, readability, and impact - use them liberally
- Most posts should have 2-4 short paragraphs, not one dense block
- Example format:
  Opening thought or hook

  Supporting point or expansion

  Closing statement or call-to-action`;

    // JSON format instructions
    prompt += `\n\nReturn suggestions as JSON:
{
  "suggestions": [
    {
      "content": "The post text with natural line breaks",
      "reasoning": "Why this matches their interests and voice",
      "angle": "hot_take|roast|hype|story|teach|question",
      "length": "short|medium|long",
      "topics": ["topic1", "topic2"]
    }
  ]
}`;

    return prompt;
  }
}

export default new PromptBuilder();
