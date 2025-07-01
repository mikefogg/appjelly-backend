const formatError = (message, code = 500, details = null) => {
  return {
    error: {
      message,
      code,
      details,
    },
  };
};

export const formatExpressValidatorError = ({ msg, param, path, value, location }) => {
  return {
    message: msg,
    field: param || path,
    value: value,
    location: location,
  };
};

export default formatError;