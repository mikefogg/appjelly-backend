import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { clerkMiddleware } from "@clerk/express";
import publicRoutes from "#src/routes/public/index.js";
import webhookRoutes from "#src/routes/webhooks/index.js";
import { globalErrorHandler, notFoundHandler } from "#src/middleware/index.js";

const app = express();

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(cookieParser());
app.use(clerkMiddleware({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
}));
app.disable("x-powered-by");
app.enable("trust proxy");

if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`, {
      body: req.body,
      query: req.query,
      params: req.params,
    });
    next();
  });
}

// Webhook routes (before standard middleware to handle raw body parsing)
app.use("/webhooks", webhookRoutes);

// Standard API routes
app.use("/", publicRoutes);

app.use(notFoundHandler);
app.use(globalErrorHandler);

// Only start server when not in test mode
if (process.env.NODE_ENV !== "TEST") {
  const PORT = process.env.PORT ?? 4001;

  const server = app.listen(PORT, () => {
    console.log(`🚀 SnuggleBug Platform API running on port ${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully");
    server.close(() => {
      console.log("Process terminated");
    });
  });

  process.on("SIGINT", () => {
    console.log("SIGINT received, shutting down gracefully");
    server.close(() => {
      console.log("Process terminated");
    });
  });
}

export default app;