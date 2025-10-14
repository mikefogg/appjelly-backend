/**
 * Enhanced logger with printf-style formatting support
 * Supports: %s (string), %d (integer), %i (integer), %f (float), %.2f (float with precision), %% (literal %)
 */
export const log = (...args) => {
  if (args.length > 1 && typeof args[0] === "string" && args[0].includes("%")) {
    try {
      let formatString = args[0];
      const values = args.slice(1);
      let valueIndex = 0;

      // Process all format specifiers in order
      formatString = formatString.replace(
        /%(?:\.(\d+))?([sdifo%])/g,
        (match, precision, type) => {
          if (type === "%") {
            return "%"; // Literal %
          }

          if (valueIndex >= values.length) {
            return match; // No more values available
          }

          const value = values[valueIndex++];

          switch (type) {
            case "s":
              return String(value);
            case "o":
              return JSON.stringify(value, null, 2);
            case "d":
            case "i":
              return String(parseInt(value) || 0);
            case "f":
              const num = parseFloat(value);
              if (isNaN(num)) return match;
              return precision ? num.toFixed(parseInt(precision)) : String(num);
            default:
              return match;
          }
        }
      );

      console.log(formatString);
    } catch (error) {
      // Fallback to standard console.log if formatting fails
      console.log(...args);
    }
  } else {
    console.log(...args);
  }
};

// Quiet the logs if we want to
export const quietLog = (...args) => {
  if (!["info", "verbose"].includes(process.env.LOG_LEVEL)) return;
  log(...args);
};

// Silent logs are ones that we really don't care about
export const silentLog = (...args) => {
  if (process.env.LOG_LEVEL !== "verbose") return;
  log(...args);
};
