const isTest = process.env.NODE_ENV?.toLowerCase().includes("test");
const useSsl = process.env.NODE_ENV === "production" || process.env.USE_DB_SSL === "true";

const knexConfig = isTest
  ? {
      client: "pg",
      connection: {
        connectionString: process.env.TEST_DATABASE_URL || "postgres://localhost:5432/snugglebug_test",
        ssl: false,
      },
      pool: {
        min: 1,
        max: 5,
      },
      migrations: {
        directory: "db/migrations",
        loadExtensions: [".js"],
      },
      seeds: {
        directory: "db/seeds",
      },
      debug: false,
    }
  : {
      client: "pg",
      connection: {
        connectionString: process.env.DATABASE_URL,
        ssl: useSsl ? { rejectUnauthorized: false } : null,
      },
      pool: {
        min: 5,
        max: parseInt(process.env.MAX_DB_POOL_SIZE || "10"),
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        idleTimeoutMillis: 60000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 100,
      },
      migrations: {
        directory: "db/migrations",
        loadExtensions: [".js"],
      },
      seeds: {
        directory: "db/seeds",
      },
      debug: process.env.KNEX_DEBUG === "true",
    };

export default knexConfig;