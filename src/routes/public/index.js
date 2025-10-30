import express from "express";
import appRoutes from "#src/routes/public/apps.js";
import accountRoutes from "#src/routes/public/accounts.js";

// Ghost routes
import oauthRoutes from "#src/routes/public/oauth.js";
import connectionsRoutes from "#src/routes/public/connections.js";
import suggestionsRoutes from "#src/routes/public/suggestions.js";
import postsRoutes from "#src/routes/public/posts.js";
import topicsRoutes from "#src/routes/public/topics.js";

const router = express.Router();

router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true, limit: '10mb' }));

router.use("/app", appRoutes);
router.use("/accounts", accountRoutes);

// Ghost routes
router.use("/oauth", oauthRoutes);
router.use("/connections", connectionsRoutes);
router.use("/suggestions", suggestionsRoutes);
router.use("/posts", postsRoutes);
router.use("/topics", topicsRoutes);

router.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

export default router;
