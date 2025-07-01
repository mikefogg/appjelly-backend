import express from "express";
import { body } from "express-validator";
import { requireAuth, requireAppContext,  handleValidationErrors } from "#src/middleware/index.js";
import { Artifact, ArtifactPage, Actor } from "#src/models/index.js";
import { successResponse, sampleStorySerializer, onboardingCompleteSerializer, suggestionsSerializer } from "#src/serializers/index.js";
import { formatError } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

const completeOnboardingValidators = [
  body("completed_steps").isArray().withMessage("Completed steps must be an array"),
  body("metadata").optional().isObject().withMessage("Metadata must be an object"),
];

router.get(
  "/sample-story",
  requireAppContext,
  async (req, res) => {
    try {

      // Get a sample story for the app
      const sampleArtifact = await Artifact.query()
        .where("app_id", res.locals.app.id)
        .whereRaw("metadata->>'is_sample' = ?", ['true'])
        .withGraphFetched("[pages(ordered), input]")
        .modifiers({
          ordered: (builder) => {
            builder.orderBy("page_number", "asc");
          },
        })
        .first();

      if (!sampleArtifact) {
        // Return a default sample story if none configured
        const data = {
          id: "sample",
          title: "Welcome to " + res.locals.app.name,
          artifact_type: "story",
          pages: [
            {
              page_number: 1,
              text: "Welcome to " + res.locals.app.name + "! Create magical stories with your favorite characters.",
              image_url: null,
            },
            {
              page_number: 2,
              text: "Add your children, pets, or imaginary friends as characters in your stories.",
              image_url: null,
            },
            {
              page_number: 3,
              text: "Watch as AI brings your ideas to life with personalized adventures!",
              image_url: null,
            },
          ],
          input: {
            prompt: "A sample story to show how " + res.locals.app.name + " works",
          },
          is_sample: true,
        };

        return res.status(200).json(successResponse(data, "Sample story retrieved successfully"));
      }

      const data = {
        id: sampleArtifact.id,
        title: sampleArtifact.title,
        artifact_type: sampleArtifact.artifact_type,
        pages: sampleArtifact.pages?.map(page => ({
          page_number: page.page_number,
          text: page.text,
          image_url: page.image_key ? `https://imagedelivery.net/${process.env.CLOUDFLARE_ACCOUNT_ID}/${page.image_key}` : null,
        })) || [],
        input: sampleArtifact.input ? {
          prompt: sampleArtifact.input.prompt,
        } : null,
        is_sample: true,
      };

      return res.status(200).json(successResponse(data, "Sample story retrieved successfully"));
    } catch (error) {
      console.error("Get sample story error:", error);
      return res.status(500).json(formatError("Failed to retrieve sample story"));
    }
  }
);

router.post(
  "/complete",
  requireAppContext, requireAuth,
  
  completeOnboardingValidators,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { completed_steps, metadata = {} } = req.body;

      // Update account metadata with onboarding completion
      const completedAt = new Date().toISOString();
      await res.locals.account.$query().patch({
        metadata: {
          ...res.locals.account.metadata,
          onboarding_completed: true,
          onboarding_completed_at: completedAt,
          onboarding_steps: completed_steps,
          onboarding_metadata: metadata,
        },
      });
      
      // Reload account to get updated data
      await res.locals.account.$query();

      const data = {
        onboarding_completed: true,
        completed_steps,
        completed_at: completedAt,
      };

      return res.status(200).json(successResponse(data, "Onboarding completed successfully"));
    } catch (error) {
      console.error("Complete onboarding error:", error);
      return res.status(500).json(formatError("Failed to complete onboarding"));
    }
  }
);

router.get(
  "/suggestions",
  requireAppContext,
  async (req, res) => {
    try {
      const { type } = req.query; // 'characters' or 'prompts'

      const suggestions = {
        characters: res.locals.app.config?.onboarding?.character_suggestions || [
          {
            type: "child",
            name_examples: ["Emma", "Lucas", "Sofia", "Oliver", "Mia"],
            description: "Your children who love adventures",
          },
          {
            type: "pet",
            name_examples: ["Buddy", "Luna", "Max", "Bella", "Charlie"],
            description: "Furry friends who join the fun",
          },
          {
            type: "adult",
            name_examples: ["Mom", "Dad", "Grandma", "Uncle Jake"],
            description: "Family members in your stories",
          },
          {
            type: "character",
            name_examples: ["Dragon", "Fairy", "Robot", "Princess"],
            description: "Magical or imaginary characters",
          },
        ],
        prompts: res.locals.app.config?.onboarding?.prompt_suggestions || [
          "A magical adventure in the backyard",
          "Meeting a friendly dragon",
          "Building the best treehouse ever",
          "A day at the enchanted zoo",
          "Finding a secret door in the library",
          "Cooking with a talking kitchen",
          "Flying to the moon in a cardboard rocket",
          "Helping lost baby animals find their families",
          "Discovering a hidden treasure map",
          "Making friends with a shy monster",
        ],
        tips: {
          characters: [
            "Use real names your children will recognize",
            "Include pets or stuffed animals they love",
            "Add personality traits in the description",
            "Upload photos to make characters more lifelike",
          ],
          prompts: [
            "Start with simple, familiar settings",
            "Include emotions or challenges to overcome",
            "Ask 'What if...' questions for inspiration",
            "Combine everyday activities with magic",
          ],
        },
      };

      const data = type === "characters" 
        ? { characters: suggestions.characters, tips: suggestions.tips.characters }
        : type === "prompts"
        ? { prompts: suggestions.prompts, tips: suggestions.tips.prompts }
        : suggestions;

      return res.status(200).json(successResponse(data, "Onboarding suggestions retrieved successfully"));
    } catch (error) {
      console.error("Get onboarding suggestions error:", error);
      return res.status(500).json(formatError("Failed to retrieve onboarding suggestions"));
    }
  }
);

// Get onboarding status for current user
router.get(
  "/status",
  requireAppContext, requireAuth,
  
  async (req, res) => {
    try {

      const { Actor, Artifact } = await import("#src/models/index.js");

      // Check what the user has completed
      const [actorsCount, artifactsCount] = await Promise.all([
        Actor.query()
          .where("account_id", res.locals.account.id)
          .where("app_id", res.locals.app.id)
          .resultSize(),
        Artifact.query()
          .where("account_id", res.locals.account.id)
          .where("app_id", res.locals.app.id)
          .resultSize(),
      ]);

      const data = {
        is_completed: res.locals.account.metadata?.onboarding_completed || false,
        completed_at: res.locals.account.metadata?.onboarding_completed_at || null,
        completed_steps: res.locals.account.metadata?.onboarding_steps || [],
        progress: {
          has_created_actors: actorsCount > 0,
          actors_count: actorsCount,
          has_created_stories: artifactsCount > 0,
          stories_count: artifactsCount,
        },
        next_steps: getNextSteps(res.locals.account.metadata, actorsCount, artifactsCount),
      };

      return res.status(200).json(successResponse(data, "Onboarding status retrieved successfully"));
    } catch (error) {
      console.error("Get onboarding status error:", error);
      return res.status(500).json(formatError("Failed to retrieve onboarding status"));
    }
  }
);

function getNextSteps(metadata, actorsCount, artifactsCount) {
  const steps = [];

  if (!metadata?.onboarding_completed) {
    if (actorsCount === 0) {
      steps.push({
        id: "create_first_actor",
        title: "Add Your First Character",
        description: "Create a character like your child or pet to star in stories",
        action: "Create Character",
      });
    }

    if (actorsCount > 0 && artifactsCount === 0) {
      steps.push({
        id: "create_first_story",
        title: "Generate Your First Story",
        description: "Write a prompt and let AI create a personalized story",
        action: "Create Story",
      });
    }

    if (actorsCount > 0 && artifactsCount > 0) {
      steps.push({
        id: "complete_onboarding",
        title: "Complete Setup",
        description: "Finish onboarding to unlock all features",
        action: "Complete Onboarding",
      });
    }
  } else {
    steps.push({
      id: "explore_features",
      title: "Explore Features",
      description: "Try sharing stories, adding more characters, or family linking",
      action: "Explore",
    });
  }

  return steps;
}

export default router;