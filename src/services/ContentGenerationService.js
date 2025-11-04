/**
 * Content Generation Service
 * Builds AI prompts with rotation context, growth rules, and user voice
 */

import { getPlatformRules } from "#src/config/platform-rules.js";
import { CONTENT_TYPES, getNextContentType, getContentTypeByKey } from "#src/config/content-types.js";

class ContentGenerationService {
  /**
   * Build a prompt with content rotation context
   * @param {Object} options
   * @param {Object} options.connectedAccount - The connected account with voice/style
   * @param {Object} options.trendingTopic - Optional trending topic to write about
   * @param {string} options.userPrompt - Optional custom user instructions
   * @param {string} options.contentType - Optional content type (auto-suggests if omitted)
   * @param {string} options.promptAngle - Optional angle (agree, disagree, question, etc.)
   * @returns {Object} { prompt, contentType, rotationPosition }
   */
  buildPromptWithRotation(options) {
    const {
      connectedAccount,
      trendingTopic = null,
      userPrompt = null,
      contentType = null,
      promptAngle = null
    } = options;

    // Determine content type
    let selectedContentType;
    if (contentType) {
      selectedContentType = getContentTypeByKey(contentType);
      if (!selectedContentType) {
        // Fallback to next in rotation if invalid key provided
        selectedContentType = getNextContentType(connectedAccount.last_content_type);
      }
    } else {
      // Auto-suggest next in rotation
      selectedContentType = getNextContentType(connectedAccount.last_content_type);
    }

    // Build the prompt
    let prompt = '';

    // Add user's voice/style context
    prompt += `# Your Voice & Style\n`;
    if (connectedAccount.voice) {
      prompt += `Voice: ${connectedAccount.voice}\n`;
    }
    if (connectedAccount.topics_of_interest) {
      prompt += `Topics of interest: ${connectedAccount.topics_of_interest}\n`;
    }
    prompt += `\n`;

    // Add platform-specific growth rules
    const platformRules = getPlatformRules(connectedAccount.platform);
    prompt += platformRules;
    prompt += `\n\n`;

    // Add content type guidance
    prompt += `# Content Type: ${selectedContentType.name}\n`;
    prompt += `${selectedContentType.description}\n\n`;
    prompt += `Guidance: ${selectedContentType.prompt_guidance}\n\n`;
    if (connectedAccount.last_content_type) {
      prompt += `Context: ${selectedContentType.next_prompt}\n\n`;
    }

    // Add topic context if from trending topic
    if (trendingTopic) {
      prompt += `# Topic to Write About\n`;
      prompt += `Topic: ${trendingTopic.topic_name}\n`;
      prompt += `Context: ${trendingTopic.context}\n\n`;

      if (promptAngle) {
        const anglePrompts = {
          agree: 'Write agreeing with this topic. Add your unique perspective.',
          disagree: 'Write a contrarian take disagreeing with this. Be bold but thoughtful.',
          hot_take: 'Write a spicy, attention-grabbing hot take. Push boundaries.',
          question: 'Write a thought-provoking question about this. Make it easy to answer.',
          personal_story: 'Share your personal experience with this. Be vulnerable and authentic.',
          explain: 'Explain this in simple terms. Break it down for beginners.',
          prediction: 'Make a prediction about where this is headed. Be specific.',
          lesson: 'Extract a lesson from this. Make it actionable.'
        };
        prompt += `Angle: ${anglePrompts[promptAngle] || 'Share your thoughts on this.'}\n\n`;
      }
    }

    // Add custom prompt if provided
    if (userPrompt) {
      prompt += `# User Request\n${userPrompt}\n\n`;
    }

    // Final instruction
    prompt += `\nWrite a Twitter/X post following ALL the rules above. `;
    prompt += `Make it a ${selectedContentType.name}. `;
    prompt += `Keep it under 280 characters unless it needs to be a thread (then use clear thread structure).`;

    return {
      prompt,
      contentType: selectedContentType.key,
      rotationPosition: selectedContentType.position
    };
  }

  /**
   * Build a rotation-aware prompt for automated generation
   * Simpler version of buildPromptWithRotation for bulk generation
   * @param {Object} options
   * @param {Object} options.contentType - The content type object
   * @param {string} options.voice - User's voice/style
   * @param {string} options.topics - Topics of interest
   * @param {Array} options.trendingTopics - Array of trending topics
   * @param {Array} options.samplePosts - Array of sample post contents
   * @param {string} options.platform - Platform (twitter, ghost, etc.)
   * @returns {string} The complete prompt
   */
  buildRotationAwarePrompt(options) {
    const {
      contentType,
      voice = null,
      topics = null,
      trendingTopics = [],
      samplePosts = [],
      platform = 'twitter'
    } = options;

    let prompt = '';

    // Add voice & topics
    prompt += `# Your Voice & Style\n`;
    if (voice) {
      prompt += `Voice: ${voice}\n`;
    }
    if (topics) {
      prompt += `Topics of interest: ${topics}\n`;
    }
    if (samplePosts.length > 0) {
      prompt += `\nExample posts in your style:\n`;
      samplePosts.slice(0, 3).forEach((post, idx) => {
        prompt += `${idx + 1}. "${post}"\n`;
      });
    }
    prompt += `\n`;

    // Add platform-specific growth rules
    const platformRules = getPlatformRules(platform);
    prompt += platformRules;
    prompt += `\n\n`;

    // Add content type guidance
    prompt += `# Content Type: ${contentType.name}\n`;
    prompt += `${contentType.description}\n\n`;
    prompt += `Guidance: ${contentType.prompt_guidance}\n\n`;

    // Add trending topics as optional inspiration
    if (trendingTopics.length > 0) {
      prompt += `# Trending Topics (Optional Inspiration)\n`;
      prompt += `You can optionally reference these trending topics if they fit naturally:\n\n`;
      trendingTopics.slice(0, 5).forEach((topic, idx) => {
        prompt += `${idx + 1}. "${topic.topic}"\n`;
        if (topic.context) {
          prompt += `   Context: ${topic.context}\n`;
        }
      });
      prompt += `\n`;
    }

    // Final instruction
    prompt += `\nWrite a ${platform === 'twitter' ? 'Twitter/X' : platform} post following ALL the rules above. `;
    prompt += `Make it a ${contentType.name}. `;
    prompt += `Keep it under 280 characters unless it needs to be a thread (then use clear thread structure).`;

    return prompt;
  }

  /**
   * Get suggested angles for a trending topic based on content type
   * @param {string} contentType - The content type key
   * @returns {Array<Object>} Array of suggested angles
   */
  getSuggestedAngles(contentType) {
    const anglesByType = {
      story: [
        { key: 'personal_story', label: 'Share your story', icon: '📖' },
        { key: 'lesson', label: 'Extract a lesson', icon: '🎓' }
      ],
      lesson: [
        { key: 'explain', label: 'Explain simply', icon: '💡' },
        { key: 'lesson', label: 'Teach a framework', icon: '🎓' }
      ],
      question: [
        { key: 'question', label: 'Ask a question', icon: '❓' },
        { key: 'disagree', label: 'Challenge it', icon: '🤔' }
      ],
      proof: [
        { key: 'agree', label: 'Support with data', icon: '📊' },
        { key: 'personal_story', label: 'Share your results', icon: '✅' }
      ],
      opinion: [
        { key: 'hot_take', label: 'Spicy take', icon: '🔥' },
        { key: 'disagree', label: 'Contrarian view', icon: '💥' },
        { key: 'agree', label: 'Strong agreement', icon: '💯' }
      ],
      personal: [
        { key: 'personal_story', label: 'Share experience', icon: '👤' },
        { key: 'lesson', label: 'What you learned', icon: '📚' }
      ],
      vision: [
        { key: 'prediction', label: 'Make a prediction', icon: '🔮' },
        { key: 'agree', label: 'Build on the vision', icon: '🚀' }
      ],
      cta: [
        { key: 'agree', label: 'Rally support', icon: '📢' },
        { key: 'question', label: 'Invite participation', icon: '🙋' }
      ]
    };

    return anglesByType[contentType] || [
      { key: 'agree', label: 'Agree & expand', icon: '👍' },
      { key: 'disagree', label: 'Contrarian take', icon: '🔥' },
      { key: 'question', label: 'Ask a question', icon: '❓' }
    ];
  }
}

export default new ContentGenerationService();
