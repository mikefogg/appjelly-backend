export const sampleStorySerializer = (story) => {
  return {
    id: story.id,
    title: story.title,
    pages: story.pages || [],
    sample: true,
  };
};

export const onboardingCompleteSerializer = (account) => {
  return {
    account_id: account.id,
    onboarding_completed: true,
    completed_at: new Date().toISOString(),
    next_steps: [
      "Create your first character",
      "Write your first story prompt",
      "Explore the story gallery",
    ],
  };
};

export const suggestionsSerializer = (suggestions) => {
  return {
    character_suggestions: suggestions.characters || [],
    prompt_suggestions: suggestions.prompts || [],
    tips: suggestions.tips || [],
  };
};