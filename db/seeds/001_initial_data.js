export async function seed(knex) {
  // Clear existing data
  await knex("artifact_pages").del();
  await knex("artifacts").del();
  await knex("inputs").del();
  await knex("media").del();
  await knex("actors").del();
  await knex("shared_views").del();
  await knex("subscriptions").del();
  await knex("account_links").del();
  await knex("accounts").del();
  await knex("apps").del();

  // Insert sample apps
  const apps = await knex("apps").insert([
    {
      id: "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      slug: "snugglebug",
      name: "SnuggleBug Stories",
      config: {
        features: ["stories", "characters", "sharing"],
        ui: {
          theme: "warm",
          primary_color: "#FF6B6B",
        },
        limits: {
          max_actors: 10,
          max_stories_per_month: 50,
        },
        ai: {
          provider: "openai",
          model: "gpt-4",
          storyLength: "medium",
        },
        onboarding: {
          character_suggestions: [
            { type: "child", name_examples: ["Emma", "Lucas", "Sofia", "Oliver"] },
            { type: "pet", name_examples: ["Buddy", "Luna", "Max", "Bella"] },
          ],
          prompt_suggestions: [
            "A magical adventure in the backyard",
            "Meeting a friendly dragon",
            "Building the best treehouse ever",
            "A day at the enchanted zoo",
          ],
        },
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "b2c3d4e5-f6g7-8901-2345-678901bcdefg",
      slug: "puptales",
      name: "PupTales Adventures",
      config: {
        features: ["stories", "characters", "sharing"],
        ui: {
          theme: "playful",
          primary_color: "#4ECDC4",
        },
        limits: {
          max_actors: 8,
          max_stories_per_month: 30,
        },
        ai: {
          provider: "openai",
          model: "gpt-4",
          storyLength: "short",
        },
        onboarding: {
          character_suggestions: [
            { type: "pet", name_examples: ["Rex", "Daisy", "Charlie", "Ruby"] },
            { type: "child", name_examples: ["Sam", "Mia", "Jake", "Zoe"] },
          ],
          prompt_suggestions: [
            "A puppy's first day at the park",
            "Finding the buried treasure",
            "The great sock mystery",
            "Meeting the neighborhood cats",
          ],
        },
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]).returning("*");

  // Insert sample accounts (for development/testing)
  if (process.env.NODE_ENV === "development") {
    const accounts = await knex("accounts").insert([
      {
        id: "c3d4e5f6-g7h8-9012-3456-789012cdefgh",
        clerk_id: "user_test123",
        email: "test@snugglebug.com",
        app_id: apps[0].id,
        metadata: {
          display_name: "Test Parent",
          onboarding_completed: true,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]).returning("*");

    // Insert sample actors
    await knex("actors").insert([
      {
        id: "d4e5f6g7-h8i9-0123-4567-890123defghi",
        account_id: accounts[0].id,
        app_id: apps[0].id,
        name: "Emma",
        type: "child",
        metadata: {
          age: 5,
          interests: ["dinosaurs", "painting", "stories"],
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "e5f6g7h8-i9j0-1234-5678-901234efghij",
        account_id: accounts[0].id,
        app_id: apps[0].id,
        name: "Buddy",
        type: "pet",
        metadata: {
          species: "dog",
          breed: "golden retriever",
          personality: ["friendly", "energetic", "loyal"],
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Insert sample input and artifact
    const inputs = await knex("inputs").insert([
      {
        id: "f6g7h8i9-j0k1-2345-6789-012345fghijk",
        account_id: accounts[0].id,
        app_id: apps[0].id,
        prompt: "Emma and Buddy discover a magical garden behind their house",
        actor_ids: JSON.stringify(["d4e5f6g7-h8i9-0123-4567-890123defghi", "e5f6g7h8-i9j0-1234-5678-901234efghij"]),
        metadata: {
          tone: "adventurous",
          theme: "friendship",
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]).returning("*");

    const artifacts = await knex("artifacts").insert([
      {
        id: "g7h8i9j0-k1l2-3456-7890-123456ghijkl",
        input_id: inputs[0].id,
        account_id: accounts[0].id,
        app_id: apps[0].id,
        artifact_type: "story",
        title: "The Magical Garden Adventure",
        metadata: {
          status: "completed",
          is_sample: true,
          generated_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]).returning("*");

    // Insert sample pages
    await knex("artifact_pages").insert([
      {
        id: "h8i9j0k1-l2m3-4567-8901-234567hijklm",
        artifact_id: artifacts[0].id,
        page_number: 1,
        text: "Emma and her golden retriever Buddy were playing in their backyard when they noticed something strange behind the old oak tree.",
        layout_data: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "i9j0k1l2-m3n4-5678-9012-345678ijklmn",
        artifact_id: artifacts[0].id,
        page_number: 2,
        text: "As they approached the tree, they discovered a hidden gate covered in sparkling vines that seemed to shimmer in the sunlight.",
        layout_data: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "j0k1l2m3-n4o5-6789-0123-456789jklmno",
        artifact_id: artifacts[0].id,
        page_number: 3,
        text: "Together, Emma and Buddy stepped through the magical gate and found themselves in the most beautiful garden they had ever seen, filled with flowers that sang and butterflies that danced.",
        layout_data: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    console.log("✅ Sample data seeded successfully!");
  }
}