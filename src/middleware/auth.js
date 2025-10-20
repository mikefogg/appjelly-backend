import { requireAuth as clerkRequireAuth } from "@clerk/express";
import { Account, App, ConnectedAccount } from "#src/models/index.js";
import formatError from "#src/helpers/format-error.js";

export const requireAuth = async (req, res, next) => {
  try {
    // First, validate the Clerk token
    const clerkMiddleware = clerkRequireAuth({
      onError: (error) => {
        console.error("Clerk auth error:", error);
        return {
          status: 401,
          message: "Authentication failed",
        };
      },
    });

    // Run Clerk's auth middleware
    await new Promise((resolve, reject) => {
      clerkMiddleware(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const authUser = req.auth();

    // If we get here, the user is authenticated
    if (!authUser?.userId) {
      return res.status(401).json(formatError("Authentication required"));
    }

    // Check if we have app context
    if (!res.locals.app?.id) {
      return res.status(400).json(formatError("App context required"));
    }

    const userId = authUser.userId;
    const app = res.locals.app;

    // Try to find or create the account
    let account = await Account.findWithSubscriptionData(userId, app.id);

    if (!account) {
      // Account doesn't exist - create it automatically
      try {
        // Fetch user profile from Clerk only once during creation
        let email = null;
        let firstName = null;
        let lastName = null;
        let imageUrl = null;

        try {
          const { clerkClient } = await import("@clerk/express");
          const clerkUser = await clerkClient.users.getUser(userId);
          email = clerkUser.primaryEmailAddress?.emailAddress;
          firstName = clerkUser.firstName;
          lastName = clerkUser.lastName;
          imageUrl = clerkUser.imageUrl;
        } catch (clerkError) {
          console.warn(
            "Failed to fetch Clerk user data during auto account creation:",
            clerkError
          );
          // Continue without Clerk data - we'll create account with just clerk_id
        }

        // Create new account
        await Account.query().insert({
          clerk_id: userId,
          email: email || null,
          app_id: app.id,
          metadata: {
            ...(firstName && { first_name: firstName }),
            ...(lastName && { last_name: lastName }),
            ...(imageUrl && { profile_image_url: imageUrl }),
            auto_created_at: new Date().toISOString(),
          },
        });

        // Reload with subscription data
        account = await Account.findWithSubscriptionData(userId, app.id);

        // Create default ghost account for new user
        try {
          await ConnectedAccount.findOrCreateGhostAccount(account.id, app.id);
        } catch (ghostError) {
          console.warn("Failed to create ghost account:", ghostError);
          // Don't fail the whole request if ghost account creation fails
        }
      } catch (creationError) {
        console.error("Failed to auto-create account:", creationError);
        return res.status(500).json(formatError("Failed to create account"));
      }
    }

    // Check if account is soft deleted
    if (account?.metadata?.deleted_at) {
      return res
        .status(404)
        .json(formatError("Account not found for this app", 404));
    }

    // Ensure ghost account exists (for existing users who signed up before this feature)
    try {
      await ConnectedAccount.findOrCreateGhostAccount(account.id, app.id);
    } catch (ghostError) {
      console.warn("Failed to ensure ghost account:", ghostError);
      // Don't fail the request if ghost account creation fails
    }

    // Set the account on res.locals for use in routes
    res.locals.account = account;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(500).json(formatError("Authentication failed"));
  }
};

export const requireAppContext = async (req, res, next) => {
  try {
    const appSlug = req.headers["x-app-slug"] || req.headers["x-app"];

    if (!appSlug) {
      return res
        .status(400)
        .json(
          formatError(
            "App context required - please include X-App-Slug header",
            400
          )
        );
    }

    const app = await App.query().findOne({ slug: appSlug });
    if (!app) {
      return res.status(404).json(formatError("App not found", 404));
    }

    res.locals.app = app;
    next();
  } catch (error) {
    console.error("App context middleware error:", error);
    return res.status(500).json(formatError("Failed to load app context"));
  }
};

export const requireSubscription = (entitlementName = null) => {
  return async (req, res, next) => {
    try {
      if (!res.locals.account) {
        return res.status(401).json(formatError("Account required"));
      }

      const hasActiveSubscription = res.locals.account.hasActiveSubscription();

      if (!hasActiveSubscription) {
        return res
          .status(403)
          .json(formatError("Active subscription required"));
      }

      if (entitlementName) {
        const hasEntitlement =
          res.locals.account.hasEntitlement(entitlementName);
        if (!hasEntitlement) {
          return res
            .status(403)
            .json(formatError(`${entitlementName} entitlement required`));
        }
      }

      next();
    } catch (error) {
      console.error("Subscription middleware error:", error);
      return res.status(500).json(formatError("Failed to verify subscription"));
    }
  };
};
