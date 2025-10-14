import OpenAI from "openai";

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateArtifact(input, actors, appConfig = {}) {
    // Check if AI bypass is enabled for development
    if (process.env.BYPASS_AI === "true") {
      return this._dev_getMockStoryResponse(input, actors);
    }

    try {
      const model =
        appConfig.aiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";

      const actorDescriptions = actors
        .map(
          (actor) =>
            `- ${actor.name}: ${actor.type} (${Object.keys(
              actor.metadata || {}
            ).join(", ")})`
        )
        .join("\n");

      const systemPrompt = this.buildArtifactSystemPrompt(
        appConfig,
        actorDescriptions
      );
      const userPrompt = this.buildArtifactUserPrompt(
        input.prompt,
        actors,
        input.metadata
      );

      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: appConfig.temperature || 0.7,
        max_tokens: appConfig.maxTokens || 2000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content generated");
      }

      return this.parseArtifactResponse(content, appConfig);
    } catch (error) {
      console.error("AI story generation error:", error);
      throw new Error("Failed to generate story");
    }
  }

  buildArtifactSystemPrompt(appConfig, actorDescriptions) {
    const defaultPrompt = `You are a creative storyteller that generates engaging, age-appropriate stories.

Characters in this story:
${actorDescriptions}

Guidelines:
- Create stories that are positive, educational, and entertaining
- Keep content appropriate for children
- Include all specified characters in meaningful ways
- Structure the story with clear beginning, middle, and end
- Use vivid but simple language
- Length should be ${
      appConfig.storyLength || "medium"
    } (short: 3-5 pages, medium: 6-8 pages, long: 10-12 pages)

Response format:
Return a JSON object with this structure:
{
  "title": "Story Title",
  "pages": [
    {
      "pageNumber": 1,
      "text": "Page text content...",
      "imagePrompt": "Description for illustration"
    }
  ]
}`;

    return appConfig.storySystemPrompt || defaultPrompt;
  }

  buildArtifactUserPrompt(userPrompt, actors, metadata = {}) {
    let prompt = `Create a story based on this prompt: "${userPrompt}"\n\n`;

    if (metadata.tone) {
      prompt += `Tone: ${metadata.tone}\n`;
    }

    if (metadata.theme) {
      prompt += `Theme: ${metadata.theme}\n`;
    }

    if (metadata.setting) {
      prompt += `Setting: ${metadata.setting}\n`;
    }

    return prompt;
  }

  parseArtifactResponse(content, appConfig = {}) {
    try {
      const parsed = JSON.parse(content);

      if (!parsed.title || !parsed.pages || !Array.isArray(parsed.pages)) {
        throw new Error("Invalid story format");
      }

      return {
        title: parsed.title,
        pages: parsed.pages.map((page, index) => ({
          pageNumber: page.pageNumber || index + 1,
          text: page.text || "",
          imagePrompt: page.imagePrompt || "",
          layoutData: page.layoutData || {},
        })),
        metadata: {
          generatedAt: new Date().toISOString(),
          aiProvider: "openai",
          model: appConfig.aiModel || "gpt-4o-mini",
        },
      };
    } catch (error) {
      console.error("Failed to parse AI response:", error);

      return {
        title: "Generated Story",
        pages: [
          {
            pageNumber: 1,
            text: content,
            imagePrompt: "A creative illustration for this story",
            layoutData: {},
          },
        ],
        metadata: {
          generatedAt: new Date().toISOString(),
          error: "Failed to parse structured response",
        },
      };
    }
  }

  async generateStoryPromptFromImages(imageDescriptions) {
    // Check if AI bypass is enabled for development
    if (process.env.BYPASS_AI === "true") {
      return `${imageDescriptions.join(", ")}`;
    }

    try {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

      const combinedDescriptions = imageDescriptions.join("\n\n");

      const prompt = `Based on these image descriptions, create a creative story prompt that would be suitable for generating a children's story:

${combinedDescriptions}

The story prompt should:
- Be 1-2 sentences long
- Capture the essence of what's happening in the images
- Be appropriate for children
- Focus on potential adventures, activities, or interactions
- Be engaging and inspiring for story creation

Only return the story prompt, nothing else.`;

      const response = await this.openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      });

      const generatedPrompt = response.choices[0]?.message?.content?.trim();

      if (!generatedPrompt) {
        throw new Error("No prompt generated");
      }

      return generatedPrompt;
    } catch (error) {
      console.error("Failed to generate story prompt from images:", error);
      // Fallback to simple prompt based on first image description
      const firstDescription = imageDescriptions[0];
      if (firstDescription) {
        // Extract the main subject and action from the description
        const subject = firstDescription.split(".")[0];
        // Clean up the description to make it more prompt-like
        const cleanedSubject = subject
          .replace(/^The image shows/, "")
          .replace(/^A /, "")
          .trim();
        return cleanedSubject.charAt(0).toUpperCase() + cleanedSubject.slice(1);
      }
      return "A pet enjoying their day at home";
    }
  }

  async generateThoughtFromImages(imageDescriptions) {
    // Check if AI bypass is enabled for development
    if (process.env.BYPASS_AI === "true") {
      return `${imageDescriptions.join(", ")}`;
    }

    try {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

      const combinedDescriptions = imageDescriptions.join("\n\n");

      const prompt = `You’re a witty, meme‑making AI narrator.  
        Look at the combined descriptions and imagine you’re inside the subject’s head.  
        Write one ultra‑short (1–2 sentence) inner monologue—enclosed in quotes—with natural pauses (ellipses or commas) and simple punctuation, so it can be spoken by a TTS engine.  
        Keep it relatable, punchy, and unexpectedly funny.

        Descriptions:
        ${combinedDescriptions}

        Only return the inner monologue, nothing else.`;

      const response = await this.openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200,
      });

      const generatedPrompt = response.choices[0]?.message?.content?.trim();

      if (!generatedPrompt) {
        throw new Error("No prompt generated");
      }

      return generatedPrompt;
    } catch (error) {
      console.error("Failed to generate pet prompt from images:", error);
      // Fallback to simple prompt based on first image description
      const firstDescription = imageDescriptions[0];
      if (firstDescription) {
        // Extract the main subject and action from the description
        const subject = firstDescription.split(".")[0];
        // Clean up the description to make it more prompt-like
        const cleanedSubject = subject
          .replace(/^The image shows/, "")
          .replace(/^A /, "")
          .trim();
        return cleanedSubject.charAt(0).toUpperCase() + cleanedSubject.slice(1);
      }
      return "A pet enjoying their day at home";
    }
  }

  async generateImagePrompt(text, style = "children's book illustration") {
    // Check if AI bypass is enabled for development
    if (process.env.BYPASS_AI === "true") {
      return `A cheerful ${style} showing ${text.substring(
        0,
        50
      )}... with bright colors and friendly characters`;
    }

    try {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

      const prompt = `Create a detailed image prompt for a ${style} based on this text: "${text}"
      
      The prompt should be descriptive, visual, and suitable for AI image generation.
      Keep it under 200 characters and focus on key visual elements.`;

      const response = await this.openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 150,
      });

      return (
        response.choices[0]?.message?.content?.trim() ||
        `${style} depicting: ${text.substring(0, 100)}...`
      );
    } catch (error) {
      console.error("Failed to generate image prompt:", error);
      return `${style} depicting: ${text.substring(0, 100)}...`;
    }
  }

  async moderateContent(text) {
    // Check if AI bypass is enabled for development
    if (process.env.BYPASS_AI === "true") {
      return {
        score: 1,
        reasoning: "Mock response - content appears safe",
        suggestions: [],
        approved: true,
        categories: {},
      };
    }

    try {
      // Use OpenAI's built-in moderation endpoint for better accuracy
      const moderationResponse = await this.openai.moderations.create({
        input: text,
      });

      const moderation = moderationResponse.results[0];
      const isFlagged = moderation.flagged;

      // Additional custom check for child-appropriate content
      if (!isFlagged) {
        const customCheck = await this.customChildSafetyCheck(text);
        return customCheck;
      }

      return {
        score: isFlagged ? 8 : 2,
        reasoning: isFlagged
          ? "Content flagged by OpenAI moderation"
          : "Content appears safe",
        suggestions: isFlagged ? ["Review and modify flagged content"] : [],
        approved: !isFlagged,
        categories: moderation.categories,
      };
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Content moderation error:", error);
      }
      return {
        score: 5,
        reasoning: "Unable to moderate content",
        suggestions: ["Manual review recommended"],
        approved: false,
      };
    }
  }

  async customChildSafetyCheck(text) {
    try {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

      const prompt = `Analyze this content for child safety and appropriateness:
      
      "${text}"
      
      Rate the content on a scale of 1-10 where:
      1-3: Completely safe and appropriate for children
      4-6: Generally safe but may need minor adjustments
      7-8: Contains questionable content that should be reviewed
      9-10: Inappropriate or harmful content
      
      Respond with JSON:
      {
        "score": number,
        "reasoning": "brief explanation",
        "suggestions": ["improvement suggestions if needed"],
        "approved": boolean
      }`;

      const response = await this.openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No moderation response");
      }

      const moderation = JSON.parse(content);
      return {
        score: moderation.score || 1,
        reasoning: moderation.reasoning || "Content appears safe",
        suggestions: moderation.suggestions || [],
        approved: moderation.approved !== false && moderation.score <= 6,
      };
    } catch (error) {
      console.error("Custom safety check error:", error);
      return {
        score: 5,
        reasoning: "Unable to complete custom safety check",
        suggestions: ["Manual review recommended"],
        approved: false,
      };
    }
  }

  //
  // Development Bypass Methods
  //

  // Mock response methods for development bypass
  _dev_getMockStoryResponse(input, actors) {
    const actorNames = actors.map((a) => a.name).join(" and ");

    return {
      title: `The Adventure of ${actorNames}`,
      pages: [
        {
          pageNumber: 1,
          text: `Once upon a time, ${actorNames} lived in a magical place where anything was possible.`,
          imagePrompt: `A whimsical children's book illustration showing ${actorNames} in a colorful, magical setting`,
          layoutData: {},
        },
        {
          pageNumber: 2,
          text: `One day, they discovered something amazing that would change everything. "${input.prompt}" they thought to themselves.`,
          imagePrompt: `An exciting scene showing ${actorNames} making a wonderful discovery`,
          layoutData: {},
        },
        {
          pageNumber: 3,
          text: `Together, they went on the most wonderful adventure, learning important lessons about friendship and courage along the way.`,
          imagePrompt: `A heartwarming illustration of ${actorNames} on their adventure, showing teamwork and joy`,
          layoutData: {},
        },
        {
          pageNumber: 4,
          text: `And they all lived happily ever after, knowing they could face any challenge as long as they had each other.`,
          imagePrompt: `A happy ending scene with ${actorNames} celebrating together`,
          layoutData: {},
        },
      ],
      metadata: {
        generatedAt: new Date().toISOString(),
        aiProvider: "mock",
        model: "development-bypass",
      },
    };
  }
}

export default new AIService();
