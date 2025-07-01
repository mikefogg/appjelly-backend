import { expect } from "vitest";

// Custom assertion helpers for consistent testing

export const expectSuccessResponse = (response, expectedStatus = 200) => {
  expect(response.status).toBe(expectedStatus);
  expect(response.body).toHaveProperty("data");
  expect(response.body).toHaveProperty("message");
  return response.body.data;
};

export const expectErrorResponse = (response, expectedStatus, expectedMessage = null) => {
  expect(response.status).toBe(expectedStatus);
  expect(response.body).toHaveProperty("error");
  expect(response.body.error).toHaveProperty("message");
  expect(response.body.error).toHaveProperty("code", expectedStatus);
  
  if (expectedMessage) {
    expect(response.body.error.message).toContain(expectedMessage);
  }
  
  return response.body.error;
};

export const expectValidationError = (response, field = null) => {
  expect(response.status).toBe(422);
  expect(response.body).toHaveProperty("errors");
  
  if (field) {
    expect(response.body.errors).toHaveProperty(field);
  }
  
  return response.body.errors;
};

export const expectPaginatedResponse = (response) => {
  const data = expectSuccessResponse(response);
  expect(response.body).toHaveProperty("meta");
  expect(response.body.meta).toHaveProperty("total");
  expect(Array.isArray(data)).toBe(true);
  return data;
};

export const expectUnauthenticatedError = (response) => {
  return expectErrorResponse(response, 401, "Unauthorized");
};

export const expectNotFoundError = (response) => {
  return expectErrorResponse(response, 404, "not found");
};

export const expectForbiddenError = (response) => {
  return expectErrorResponse(response, 403, "Forbidden");
};