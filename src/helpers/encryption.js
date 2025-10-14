/**
 * Encryption utility for sensitive data like OAuth tokens
 * Uses AES-256-GCM for encryption with authentication
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;

/**
 * Get or generate encryption key from environment
 */
function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  // Derive a proper 256-bit key from the environment variable
  return crypto.pbkdf2Sync(key, "ghost-salt", 100000, KEY_LENGTH, "sha256");
}

/**
 * Encrypt a string value
 * Returns: base64 encoded string containing: salt:iv:authTag:encryptedData
 */
export function encrypt(text) {
  if (!text) return null;

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    // Combine iv:authTag:encrypted and encode as base64
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, "hex"),
    ]);

    return combined.toString("base64");
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
}

/**
 * Decrypt an encrypted string
 * Input: base64 encoded string containing: iv:authTag:encryptedData
 */
export function decrypt(encryptedText) {
  if (!encryptedText) return null;

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedText, "base64");

    // Extract components
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, null, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt data");
  }
}

/**
 * Generate a random encryption key (for setup)
 * Use this to generate ENCRYPTION_KEY for .env
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString("hex");
}

export default { encrypt, decrypt, generateEncryptionKey };
