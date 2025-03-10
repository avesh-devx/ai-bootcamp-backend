const winston = require("winston");
const { format } = winston;

// Custom log format
const customFormat = format.printf(
  ({ timestamp, level, message, ...metadata }) => {
    return `${timestamp} [${level}]: ${JSON.stringify(message, null, 2)}`;
  }
);

// Configure Winston logger
const logger = winston.createLogger({
  level: "info", // Log level (info, error, etc.)
  format: format.combine(
    format.timestamp({ format: "DD/MM/YYYY HH:mm:ss" }), // Custom timestamp format
    customFormat // Use custom log format
  ),
  transports: [
    // Log to console
    new winston.transports.Console({
      format: format.combine(
        format.colorize(), // Add colors to console logs
        customFormat
      ),
    }),
    // Log to a file
    new winston.transports.File({ filename: "logs/app.log" }), // Logs will be saved in a `logs` directory
  ],
});

module.exports = logger;
