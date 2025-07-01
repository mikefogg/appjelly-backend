/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = function(knex) {
  // No changes needed - we're keeping image_key and owner_id as NOT NULL
  // since we'll always have complete data before creating Media records
  return Promise.resolve();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = function(knex) {
  // No changes to revert
  return Promise.resolve();
};
