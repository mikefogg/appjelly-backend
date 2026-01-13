/**
 * Platform Length Configuration
 * Defines optimal character lengths for each platform by size bucket
 */

export const PLATFORM_LENGTHS = {
  linkedin: {
    name: "LinkedIn",
    label: "LinkedIn",
    shortname: "LI",
    icon: "linkedin",
    short: 200, medium: 600, long: 1300,
  },
  twitter: {
    name: "X",
    label: "X (Twitter)",
    shortname: "X",
    icon: "x-twitter",
    short: 100, medium: 280, long: 2000,
  },
  threads: {
    name: "Threads",
    label: "Threads",
    shortname: "TH",
    icon: "threads",
    short: 150, medium: 300, long: 500,
  },
  facebook: {
    name: "Facebook",
    label: "Facebook",
    shortname: "FB",
    icon: "facebook",
    short: 100, medium: 400, long: 2000,
  },
  instagram: {
    name: "Instagram",
    label: "Instagram",
    shortname: "IG",
    icon: "instagram",
    short: 150, medium: 300, long: 2200,
  },
  tiktok: {
    name: "TikTok",
    label: "TikTok",
    shortname: "TT",
    icon: "tiktok",
    short: 150, medium: 300, long: 2000,
  },
  ghost: {
    name: "Ghost",
    label: "Ghost",
    shortname: "GH",
    icon: "ghost",
    short: 150, medium: 300, long: 2000,
  },
  custom: {
    name: "Custom",
    label: "Custom",
    shortname: "CU",
    icon: "custom",
    short: 150, medium: 300, long: 2000,
  },
};

/**
 * Get length config for a platform
 * @param {string} platform
 * @returns {Object} { short, medium, long }
 */
export function getPlatformLengths(platform) {
  return PLATFORM_LENGTHS[platform] || PLATFORM_LENGTHS.ghost;
}

/**
 * Determine which bucket a character count falls into
 * @param {string} platform
 * @param {number} charCount
 * @returns {string} "short" | "medium" | "long"
 */
export function getLengthBucket(platform, charCount) {
  const lengths = getPlatformLengths(platform);

  // Midpoints between buckets
  const shortMediumThreshold = (lengths.short + lengths.medium) / 2;
  const mediumLongThreshold = (lengths.medium + lengths.long) / 2;

  if (charCount <= shortMediumThreshold) return "short";
  if (charCount <= mediumLongThreshold) return "medium";
  return "long";
}

/**
 * Get target length for a bucket
 * @param {string} platform
 * @param {string} bucket - "short" | "medium" | "long"
 * @returns {number}
 */
export function getTargetLength(platform, bucket) {
  const lengths = getPlatformLengths(platform);
  return lengths[bucket] || lengths.medium;
}

/**
 * Get next bucket up (for expand)
 * @param {string} currentBucket
 * @returns {string|null} Next bucket or null if already at max
 */
export function getNextBucketUp(currentBucket) {
  if (currentBucket === "short") return "medium";
  if (currentBucket === "medium") return "long";
  return null; // Already at long
}

/**
 * Get next bucket down (for shrink)
 * @param {string} currentBucket
 * @returns {string|null} Next bucket or null if already at min
 */
export function getNextBucketDown(currentBucket) {
  if (currentBucket === "long") return "medium";
  if (currentBucket === "medium") return "short";
  return null; // Already at short
}

/**
 * Get list of all supported platforms
 * @returns {string[]}
 */
export function getSupportedPlatforms() {
  return Object.keys(PLATFORM_LENGTHS);
}

/**
 * Check if a platform is supported
 * @param {string} platform
 * @returns {boolean}
 */
export function isPlatformSupported(platform) {
  return platform in PLATFORM_LENGTHS;
}
