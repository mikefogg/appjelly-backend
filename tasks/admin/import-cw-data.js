/**
 * Import Caption Writer data from CSV files into Ghost database
 *
 * Usage:
 *   node tasks/admin/import-cw-data.js [--dry-run]
 *
 * Expects CSV files in data/ directory:
 *   - cw_users.csv
 *   - cw_folders.csv
 *   - cw_captions.csv (or cw_captions_part_*.csv for split files)
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import { knex } from "#src/models/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../../data");

const BATCH_SIZE = 500;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("=".repeat(60));
  console.log("Caption Writer Data Import");
  console.log("=".repeat(60));
  console.log(`Dry run: ${dryRun}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log("");

  try {
    // Import users
    await importTableStreaming(
      "cw_users",
      "cw_users.csv",
      ["id", "email", "created_at", "updated_at"],
      dryRun
    );

    // Import folders
    await importTableStreaming(
      "cw_folders",
      "cw_folders.csv",
      ["id", "local_id", "user_id", "name", "folder_id", "network", "created_at", "updated_at"],
      dryRun
    );

    // Import captions - check for split files first
    const captionFiles = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.startsWith("cw_captions_part_") && f.endsWith(".csv"))
      .sort();

    if (captionFiles.length > 0) {
      console.log(`\nFound ${captionFiles.length} caption files to import`);
      for (const file of captionFiles) {
        await importTableStreaming(
          "cw_captions",
          file,
          [
            "id",
            "local_id",
            "user_id",
            "name",
            "content",
            "count_hashtags",
            "count_characters",
            "folder_id",
            "network",
            "network_placement",
            "created_at",
            "updated_at",
          ],
          dryRun
        );
      }
    } else {
      // Single file
      await importTableStreaming(
        "cw_captions",
        "cw_captions.csv",
        [
          "id",
          "local_id",
          "user_id",
          "name",
          "content",
          "count_hashtags",
          "count_characters",
          "folder_id",
          "network",
          "network_placement",
          "created_at",
          "updated_at",
        ],
        dryRun
      );
    }

    console.log("\nImport complete!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await knex.destroy();
  }

  process.exit(0);
}

/**
 * Stream import a CSV file into a table
 */
async function importTableStreaming(tableName, csvFileName, columns, dryRun) {
  const csvPath = path.join(DATA_DIR, csvFileName);

  console.log(`\nImporting ${tableName} from ${csvFileName}...`);

  if (!fs.existsSync(csvPath)) {
    console.log(`  Skipping: ${csvPath} not found`);
    return;
  }

  const stats = { inserted: 0, skipped: 0, errors: 0, total: 0 };
  const startTime = Date.now();

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let headers = null;
  let batch = [];
  let currentRow = "";
  let inQuotes = false;

  for await (const line of rl) {
    // Handle multi-line quoted fields
    if (inQuotes) {
      currentRow += "\n" + line;
      // Count quotes to see if we're closing
      const quoteCount = (line.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) {
        inQuotes = false;
      }
    } else {
      currentRow = line;
      const quoteCount = (line.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) {
        inQuotes = true;
        continue;
      }
    }

    if (inQuotes) continue;

    const values = parseCSVLine(currentRow);
    currentRow = "";

    // First row is headers
    if (!headers) {
      headers = values.map((h) => h.toLowerCase().trim());
      continue;
    }

    stats.total++;

    // Build row object
    const row = {};
    for (const col of columns) {
      const headerIndex = headers.indexOf(col);
      if (headerIndex >= 0 && headerIndex < values.length) {
        let value = values[headerIndex];

        // Handle null values
        if (value === "" || value === "\\N") {
          value = null;
        } else if (col.startsWith("count_") || col === "id" || col === "user_id") {
          // Parse integers
          const parsed = parseInt(value, 10);
          value = isNaN(parsed) ? null : parsed;
        }

        row[col] = value;
      } else {
        row[col] = null;
      }
    }

    // Skip rows without required fields
    if (row.id == null) {
      stats.skipped++;
      continue;
    }
    // For captions and folders, user_id is required
    if ((tableName === "cw_captions" || tableName === "cw_folders") && row.user_id == null) {
      stats.skipped++;
      continue;
    }
    batch.push(row);

    // Insert batch
    if (batch.length >= BATCH_SIZE) {
      if (!dryRun) {
        try {
          await knex(tableName).insert(batch).onConflict("id").ignore();
          stats.inserted += batch.length;
        } catch (error) {
          console.error(`  Error inserting batch: ${error.message}`);
          stats.errors += batch.length;
        }
      } else {
        stats.inserted += batch.length;
      }
      batch = [];

      // Progress update
      if (stats.total % 10000 === 0) {
        console.log(`  Progress: ${stats.total} rows processed, ${stats.inserted} inserted...`);
      }
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    if (!dryRun) {
      try {
        await knex(tableName).insert(batch).onConflict("id").ignore();
        stats.inserted += batch.length;
      } catch (error) {
        console.error(`  Error inserting final batch: ${error.message}`);
        stats.errors += batch.length;
      }
    } else {
      stats.inserted += batch.length;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Done: ${stats.inserted} inserted, ${stats.skipped} skipped, ${stats.errors} errors, ${stats.total} total (${elapsed}s)`);
}

/**
 * Parse a CSV line handling quoted fields with embedded commas and newlines
 */
function parseCSVLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          current += '"';
          i++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }

  values.push(current);
  return values;
}

main();
