import express from "express";
import { requireAppContext } from "#src/middleware/index.js";
import { App, Artifact } from "#src/models/index.js";
import { appConfigSerializer, successResponse } from "#src/serializers/index.js";
import { formatError } from "#src/helpers/index.js";

const router = express.Router({ mergeParams: true });

router.get("/config", requireAppContext, async (req, res) => {
  try {
    const app = res.locals.app;

    const data = appConfigSerializer(app);
    return res.status(200).json(successResponse(data, "App configuration retrieved"));
  } catch (error) {
    console.error("Get app config error:", error);
    return res.status(500).json(formatError("Failed to retrieve app configuration"));
  }
});

export default router;