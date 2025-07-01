import formatError from "#src/helpers/format-error.js";

export const globalErrorHandler = (err, req, res, next) => {
  console.error("Unhandled error:", {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (err.name === "ValidationError") {
    return res.status(400).json(formatError("Validation failed", err.message));
  }

  if (err.name === "UniqueViolationError") {
    return res.status(409).json(formatError("Resource already exists"));
  }

  if (err.name === "NotFoundError") {
    return res.status(404).json(formatError("Resource not found"));
  }

  if (err.name === "ForeignKeyViolationError") {
    return res.status(400).json(formatError("Invalid reference"));
  }

  if (err.name === "CheckViolationError") {
    return res.status(400).json(formatError("Data constraint violation"));
  }

  if (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED") {
    return res.status(503).json(formatError("Service temporarily unavailable"));
  }

  if (err.statusCode && err.statusCode < 500) {
    return res.status(err.statusCode).json(formatError(err.message || "Client error"));
  }

  return res.status(500).json(formatError("Internal server error"));
};

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    code: 404,
    status: "Error",
    message: "Route not found",
    data: null,
  });
};