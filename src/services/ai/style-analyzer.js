/**
 * AI Style Analyzer Service
 * Analyzes user's post history to extract writing style
 */

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class StyleAnalyzerService {
  constructor() {
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  /**
   * Analyze user's writing style from post history
   */
  async analyzeStyle(posts, options = {}) {
    const { platform = "twitter" } = options;

    if (!posts || posts.length < 5) {
      throw new Error("Need at least 5 posts to analyze writing style");
    }

    const startTime = Date.now();

    try {
      // Calculate basic statistics
      const basicStats = this.calculateBasicStats(posts);

      // Use AI to analyze tone and style
      const aiAnalysis = await this.performAIAnalysis(posts, platform);

      // Combine stats and AI analysis
      const writingStyle = {
        ...basicStats,
        ...aiAnalysis,
        sample_size: posts.length,
        confidence_score: this.calculateConfidenceScore(posts.length),
        analyzed_at: new Date().toISOString(),
        generation_time_seconds: (Date.now() - startTime) / 1000,
      };

      return writingStyle;
    } catch (error) {
      console.error("Style analysis error:", error);
      throw new Error(`Failed to analyze writing style: ${error.message}`);
    }
  }

  /**
   * Calculate basic statistical metrics
   */
  calculateBasicStats(posts) {
    const stats = {
      total_posts: posts.length,
      avg_length: 0,
      emoji_frequency: 0,
      hashtag_frequency: 0,
      question_frequency: 0,
      common_phrases: [],
      common_topics: [],
      posting_times: [],
    };

    let totalLength = 0;
    let emojiCount = 0;
    let hashtagCount = 0;
    let questionCount = 0;
    const phrases = {};
    const hourCounts = Array(24).fill(0);

    posts.forEach(post => {
      const content = post.content || "";

      // Length
      totalLength += content.length;

      // Emojis (basic check)
      const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
      if (emojiRegex.test(content)) {
        emojiCount++;
      }

      // Hashtags
      if (content.includes("#")) {
        hashtagCount++;
      }

      // Questions
      if (content.includes("?")) {
        questionCount++;
      }

      // Extract potential phrases (3-4 word sequences)
      const words = content.toLowerCase().split(/\s+/);
      for (let i = 0; i < words.length - 2; i++) {
        const phrase = words.slice(i, i + 3).join(" ");
        if (phrase.length > 10) {
          phrases[phrase] = (phrases[phrase] || 0) + 1;
        }
      }

      // Posting time
      if (post.posted_at) {
        const hour = new Date(post.posted_at).getHours();
        hourCounts[hour]++;
      }
    });

    stats.avg_length = Math.round(totalLength / posts.length);
    stats.emoji_frequency = parseFloat((emojiCount / posts.length).toFixed(2));
    stats.hashtag_frequency = parseFloat((hashtagCount / posts.length).toFixed(2));
    stats.question_frequency = parseFloat((questionCount / posts.length).toFixed(2));

    // Get most common phrases
    stats.common_phrases = Object.entries(phrases)
      .filter(([phrase, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase]) => phrase);

    // Get posting times (hours with most posts)
    stats.posting_times = hourCounts
      .map((count, hour) => ({ hour, count }))
      .filter(h => h.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(h => h.hour);

    return stats;
  }

  /**
   * Perform AI-based style analysis
   */
  async performAIAnalysis(posts, platform) {
    const systemPrompt = `You are an expert at analyzing writing styles for ${platform} posts.

Analyze the provided posts and identify:
1. Overall tone (casual, professional, humorous, thoughtful, etc.)
2. Writing style description
3. Common topics or themes
4. Unique characteristics

Return a JSON object with:
{
  "tone": "brief description of tone",
  "style_summary": "2-3 sentence description of writing style",
  "common_topics": ["topic1", "topic2", "topic3"],
  "characteristics": ["characteristic1", "characteristic2"]
}`;

    // Sample up to 20 posts for analysis
    const samplePosts = posts.slice(0, 20);

    const userPrompt = `Analyze these ${samplePosts.length} posts and identify the writing style:

${samplePosts.map((post, idx) => `${idx + 1}. "${post.content}"`).join("\n\n")}

Identify the tone, style, topics, and unique characteristics.`;

    const response = await openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3, // Lower temperature for more consistent analysis
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content);

    return {
      tone: result.tone,
      style_summary: result.style_summary,
      common_topics: result.common_topics || [],
      characteristics: result.characteristics || [],
    };
  }

  /**
   * Calculate confidence score based on sample size
   */
  calculateConfidenceScore(sampleSize) {
    // Confidence increases with more samples, maxing out at 100 posts
    if (sampleSize >= 100) return 0.95;
    if (sampleSize >= 50) return 0.85;
    if (sampleSize >= 25) return 0.75;
    if (sampleSize >= 10) return 0.65;
    return 0.50;
  }

  /**
   * Update writing style with new posts (incremental update)
   */
  async updateStyle(currentStyle, newPosts) {
    if (!newPosts || newPosts.length === 0) {
      return currentStyle;
    }

    // Combine old and new for recalculation
    // In practice, you might want to weight recent posts more heavily
    const allPosts = [...(currentStyle.recent_posts || []), ...newPosts];

    // Keep only last 100 posts for analysis
    const postsToAnalyze = allPosts.slice(-100);

    return await this.analyzeStyle(postsToAnalyze);
  }
}

export default new StyleAnalyzerService();
