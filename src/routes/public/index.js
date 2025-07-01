import express from "express";
import authRoutes from "#src/routes/public/auth.js";
import appRoutes from "#src/routes/public/apps.js";
import accountRoutes from "#src/routes/public/accounts.js";
import actorRoutes from "#src/routes/public/actors.js";
import accountLinkRoutes from "#src/routes/public/account-links.js";
import inputRoutes from "#src/routes/public/inputs.js";
import artifactRoutes from "#src/routes/public/artifacts.js";
import sharedViewRoutes from "#src/routes/public/shared-views.js";
import mediaRoutes from "#src/routes/public/media.js";
import mediaSessionRoutes from "#src/routes/public/media-sessions.js";
import subscriptionRoutes from "#src/routes/public/subscriptions.js";
import onboardingRoutes from "#src/routes/public/onboarding.js";
import contentSafetyRoutes from "#src/routes/public/content-safety.js";

const router = express.Router();

router.use(express.json({ limit: '10mb' }));
router.use(express.urlencoded({ extended: true, limit: '10mb' }));

router.use("/auth", authRoutes);
router.use("/app", appRoutes);
router.use("/accounts", accountRoutes);
router.use("/actors", actorRoutes);
router.use("/account-links", accountLinkRoutes);
router.use("/inputs", inputRoutes);
router.use("/artifacts", artifactRoutes);
router.use("/shared-views", sharedViewRoutes);
router.use("/media", mediaRoutes);
router.use("/media-sessions", mediaSessionRoutes);
router.use("/subscriptions", subscriptionRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/content-safety", contentSafetyRoutes);

router.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

export default router;