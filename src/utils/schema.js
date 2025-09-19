const { z } = require("zod");

// Define structured output schemas with Zod
const categorySchema = z.object({
  category: z.enum([
    "WFH",
    "WORK FROM HOME",
    "FULL DAY LEAVE",
    "HALF DAY LEAVE",
    "LATE TO OFFICE",
    "LEAVING EARLY",
  ]),
  confidence: z.number().min(0).max(1),
});

// Zod for schema validation of AI outputs
const detailsSchema = z.object({
  isWorkingFromHome: z.boolean(),
  isLeaveRequest: z.boolean(),
  isRunningLate: z.boolean(),
  isLeavingEarly: z.boolean(),
  reason: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  durationDays: z.number().nullable(), // Explicitly capture duration in days
  additionalDetails: z.record(z.string(), z.any()).optional(),
});

const queryParserSchema = z.object({
  queryType: z.enum(["count", "list", "trend", "summary"]),
  category: z.string().optional(),
  timeFrame: z.union([
    z.enum(["day", "week", "month", "quarter"]),
    z.object({
      start: z.string(),
      end: z.string(),
    }),
  ]),
  groupBy: z.enum(["user", "day", "category"]).nullable(),
  limit: z.number().optional(),
  filters: z.record(z.string(), z.any()).optional(),
});

module.exports = {
  categorySchema,
  detailsSchema,
  queryParserSchema,
};
