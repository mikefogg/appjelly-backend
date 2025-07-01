import jwt from "jsonwebtoken";
import { vi } from "vitest";

// Mock Clerk authentication
export const mockClerkAuth = () => {
  vi.mock("@clerk/express", () => ({
    ClerkExpressWithAuth: () => (req, res, next) => {
      // Add mock auth to request
      req.auth = {
        userId: null,
        sessionId: null,
      };
      next();
    },
    ClerkExpressRequireAuth: () => (req, res, next) => {
      if (!req.auth?.userId) {
        return res.status(401).json({
          error: { message: "Unauthorized", code: 401 }
        });
      }
      next();
    },
  }));
};

// Generate test JWT token
export const generateTestJWT = (payload) => {
  return jwt.sign(payload, "test-secret", { expiresIn: "1h" });
};

// Create authenticated request headers
export const createAuthHeaders = (userId, appSlug = "test-app") => {
  return {
    "X-App-Slug": appSlug,
    "Authorization": `Bearer ${generateTestJWT({ userId })}`,
  };
};

// Mock authenticated user in request
export const mockAuthenticatedUser = (req, userId) => {
  req.auth = {
    userId,
    sessionId: `session_${userId}`,
  };
  return req;
};