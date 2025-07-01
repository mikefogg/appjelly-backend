import { validationResult } from "express-validator";
import formatError, { formatExpressValidatorError } from "#src/helpers/format-error.js";

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req).formatWith(formatExpressValidatorError);
  
  if (!errors.isEmpty()) {
    // Convert array of errors to object with field names as keys
    const errorsByField = {};
    errors.array().forEach(error => {
      errorsByField[error.field] = error.message;
    });
    
    return res.status(422).json({
      code: 422,
      status: "Validation Error", 
      message: "Request validation failed",
      errors: errorsByField,
    });
  }
  
  next();
};

export const rateLimitByAccount = (maxRequests = 100, windowMs = 60000) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const accountId = res.locals.account?.id;
    
    if (!accountId) {
      return next();
    }
    
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!requests.has(accountId)) {
      requests.set(accountId, []);
    }
    
    const accountRequests = requests.get(accountId);
    const validRequests = accountRequests.filter(timestamp => timestamp > windowStart);
    
    if (validRequests.length >= maxRequests) {
      return res.status(429).json(formatError("Rate limit exceeded"));
    }
    
    validRequests.push(now);
    requests.set(accountId, validRequests);
    
    setTimeout(() => {
      const current = requests.get(accountId) || [];
      const filtered = current.filter(timestamp => timestamp > Date.now() - windowMs);
      if (filtered.length === 0) {
        requests.delete(accountId);
      } else {
        requests.set(accountId, filtered);
      }
    }, windowMs);
    
    next();
  };
};