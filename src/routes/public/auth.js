import express from "express";

const router = express.Router({ mergeParams: true });

// Auth routes have been moved to /accounts for better organization
// All account-related functionality is now under /accounts/me

export default router;
