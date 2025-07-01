import express from "express";
import { requireAppContext } from "#src/middleware/index.js";
import { App, Artifact } from "#src/models/index.js";
import { appConfigSerializer, successResponse } from "#src/serializers/index.js";
import { formatError } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

router.get("/config", requireAppContext, async (req, res) => {
  try {
    const app = res.locals.app;

    const data = appConfigSerializer(app);
    return res.status(200).json(successResponse(data, "App configuration retrieved"));
  } catch (error) {
    console.error("Get app config error:", error);
    return res.status(500).json(formatError("Failed to retrieve app configuration"));
  }
});

router.get("/sample-content", requireAppContext, async (req, res) => {
  try {
    const app = res.locals.app;

    // Use custom sample content if provided, otherwise defaults
    const customSampleContent = app.config?.sample_content;
    
    const sampleData = {
      sample_stories: customSampleContent?.stories || [
        {
          title: "The Magic Forest Adventure",
          preview: "Once upon a time, a brave child discovered a hidden path in their backyard that led to an enchanted forest...",
          characters: ["Brave Explorer", "Wise Owl", "Friendly Fox"]
        },
        {
          title: "The Dragon's Secret",
          preview: "High in the mountains lived a gentle dragon who had a wonderful secret to share with new friends...",
          characters: ["Kind Child", "Gentle Dragon", "Mountain Guide"]
        }
      ],
      sample_characters: customSampleContent?.characters || [
        { name: "Emma", type: "child", traits: ["brave", "curious"] },
        { name: "Max", type: "pet", traits: ["loyal", "playful"] },
        { name: "Luna", type: "pet", traits: ["wise", "magical"] },
        { name: "Hero", type: "character", traits: ["brave", "kind"] }
      ],
      sample_prompts: customSampleContent?.prompts || [
        "A magical adventure in the backyard",
        "Meeting a friendly dragon",
        "Building the best treehouse ever",
        "Discovering a secret passage",
        "A day at the magical zoo"
      ]
    };

    return res.status(200).json(successResponse(sampleData, "Sample content retrieved"));
  } catch (error) {
    console.error("Get sample content error:", error);
    return res.status(500).json(formatError("Failed to retrieve sample content"));
  }
});

export default router;