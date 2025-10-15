// Ghost app serializers - only includes what's actually used
export {
  appSerializer,
  appListSerializer,
  appConfigSerializer,
} from "#src/serializers/app-serializer.js";

export {
  accountSerializer,
  currentAccountSerializer,
  publicAccountSerializer,
} from "#src/serializers/account-serializer.js";

// Utility response formatters
export const successResponse = (data, message = "Success") => {
  return {
    code: 200,
    status: "Success",
    message,
    data,
  };
};

export const createdResponse = (data, message = "Created successfully") => {
  return {
    code: 201,
    status: "Created",
    message,
    data,
  };
};

export const paginatedResponse = (data, pagination = {}) => {
  return {
    code: 200,
    status: "Success",
    message: "Data retrieved successfully",
    data,
    meta: {
      pagination: {
        page: pagination.page || 1,
        per_page: pagination.per_page || 50,
        has_more: pagination.has_more || false,
      },
      total: pagination.total || data.length,
    },
  };
};
