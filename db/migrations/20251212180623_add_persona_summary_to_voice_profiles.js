/**
 * Add persona_summary to voice_profiles
 * This stores a distilled "who they are" description derived from bio
 * Used to give AI context about the person, not just their writing style
 */

export function up(knex) {
  return knex.schema.alterTable("voice_profiles", (table) => {
    table.text("persona_summary").nullable();
  });
}

export function down(knex) {
  return knex.schema.alterTable("voice_profiles", (table) => {
    table.dropColumn("persona_summary");
  });
}
