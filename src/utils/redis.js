import redis from "redis";
import { promisify } from "util";

// Connect to a local redis instance locally, and the Heroku-provided URL in production
let REDIS_URL = process.env.REDISCLOUD_URL || process.env.REDIS_URL || "redis://127.0.0.1:6379";

//
// Setup Redis
//

export const redisOptsFromUrl = (url) => {
  const redisOpts = {};
  try {
    const redisUrl = new URL(url);
    redisOpts.port = parseInt(redisUrl.port) || 6379;
    redisOpts.host = redisUrl.hostname;
    if (redisUrl.password) {
      redisOpts.username = redisUrl.username;
      redisOpts.password = redisUrl.password;
    }
    if (redisUrl.protocol === "rediss:") {
      redisOpts.tls = {
        rejectUnauthorized: false,
      };
    }
  } catch (e) {
    throw new Error(e.message);
  }
  return redisOpts;
};

export const simpleRedisOptsFromUrl = (url) => {
  const redisOpts = {
    url,
  };
  try {
    if (url.includes("rediss:")) {
      redisOpts.socket = {
        tls: true,
        rejectUnauthorized: false,
      };
    }
  } catch (e) {
    throw new Error(e.message);
  }
  return redisOpts;
};

// Helper function to get a promisified Redis command
export async function getRedisCommand(commandName) {
  const client = await getClient();
  return promisify(client[commandName]).bind(client);
}

// Helper function to safely get Redis commands with fallback
export async function safeGetRedisCommand(commandName) {
  try {
    const command = await getRedisCommand(commandName);
    if (typeof command === "function") {
      return command;
    }
    console.log(`Warning: getRedisCommand returned non-function for ${commandName}. Falling back to direct client usage.`);
  } catch (error) {
    console.log(`Error getting Redis command ${commandName}:`, error);
  }

  // Fallback to using the Redis client directly
  const client = await getClient();
  if (typeof client[commandName] !== "function") {
    throw new Error(`Redis command ${commandName} not found on client`);
  }
  return promisify(client[commandName]).bind(client);
}

// Helper function to safely execute Redis commands
export async function safeExecuteRedisCommand(commandName, ...args) {
  const client = await getClient();
  if (typeof client.commandOptions !== "function") {
    throw new Error("Unexpected Redis client structure");
  }
  try {
    return await client.commandOptions({}).command([commandName, ...args]);
  } catch (error) {
    console.log(`Error executing Redis command ${commandName}:`, error);
    throw error;
  }
}

//
// Helpers for managing jobs
//

export const clearAllRepeatableJobs = async (queue) => {
  const repeatableJobs = await queue.getRepeatableJobs();
  console.log("Reset", queue.name);
  return Promise.all(repeatableJobs.map((job) => queue.removeRepeatableByKey(job.key)));
};

export const clearAllStandardJobs = async (queue) => {
  // 'completed' | 'wait' | 'active' | 'paused' | 'prioritized' | 'delayed' | 'failed'
  await queue.clean(0, 999999, "wait");
  await queue.clean(0, 999999, "active");
  await queue.clean(0, 999999, "paused");
  await queue.clean(0, 999999, "delayed");
  await queue.clean(0, 999999, "failed");
  await queue.clean(0, 999999, "prioritized");
  await queue.clean(0, 999999, "completed");
  await queue.drain(true);
  console.log("Reset", queue.name);
  return Promise.resolve();
};

export const redisOpts = redisOptsFromUrl(REDIS_URL);
export const simpleRedisOpts = simpleRedisOptsFromUrl(REDIS_URL);

//
// Create a reusable client
//

let client;
let pingTimeout;

async function getClient() {
  if (!client) {
    console.log("Creating new Redis client", REDIS_URL);
    client = redis.createClient({
      ...simpleRedisOpts,
      retry_strategy: (options) => {
        if (options.error) {
          if (options.error.code === "ECONNREFUSED") {
            console.error("Redis server refused the connection");
          } else {
            console.error(`Redis connection error: ${options.error.code}`);
          }
          return new Error("Connection failure");
        }

        if (options.total_retry_time > 1000 * 60 * 60) {
          console.error("Retry time exhausted");
          return new Error("Retry time exhausted");
        }

        if (options.attempt > 10) {
          console.error("Max attempts reached");
          return undefined;
        }

        // Exponential backoff strategy
        return Math.min(100 * Math.pow(2, options.attempt), 3000);
      },
    });

    // Event listeners
    client.on("error", (err) => {
      console.error("Redis client error:", err);
    });

    client.on("connect", () => {
      console.log("Connected to Redis");
    });

    client.on("ready", () => {
      console.log("Redis client ready");
    });

    client.on("reconnecting", (details) => {
      console.log(`Redis client reconnecting: attempt ${details?.attempt}, delay ${details?.delay}ms`);
    });

    client.on("end", () => {
      console.log("Redis client disconnected");
      client = null; // Reset client on disconnection
      getClient(); // Reconnect immediately
    });

    // Connect to the Redis server
    try {
      if (pingTimeout) clearTimeout(pingTimeout);

      await client.connect();

      // Setup a heartbeat mechanism (ping every 10 seconds)
      pingTimeout = setInterval(async () => {
        try {
          const client = await getClient();
          await client.ping();
          // Quiet log for successful pings
          if (process.env.NODE_ENV === "development") {
            console.log("Redis ping successful");
          }
        } catch (err) {
          console.error("Redis ping failed:", err);
        }
      }, 10000);
    } catch (err) {
      console.error("Failed to connect to Redis:", err);
      client = null; // Ensure client is null if connection fails
    }
  }

  return client;
}

export default getClient;