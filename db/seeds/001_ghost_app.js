/**
 * Seed Ghost app
 */
export async function seed(knex) {
  // Insert Ghost app
  await knex("apps").insert([
    {
      id: knex.raw("gen_random_uuid()"),
      slug: "ghost",
      name: "Ghost",
      config: JSON.stringify({
        features: {
          twitter: true,
          threads: false,
          linkedin: false,
        },
        limits: {
          max_connected_accounts_per_platform: 1,
          daily_suggestions: 3,
          sync_interval_hours: 24,
        },
      }),
    },
  ]).onConflict("slug").ignore();
}
