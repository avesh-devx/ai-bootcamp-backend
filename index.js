const express = require("express");
const app = express();
const { App } = require("@slack/bolt");
const dotenv = require("dotenv");
const logger = require("./src/libs/loggerConfig");
const supabase = require("./src/libs/supabaseClient");

const { HuggingFaceInference } = require("@langchain/community/llms/hf");

const { format, addDays } = require("date-fns");

// Import LangChain components
const { z } = require("zod");
const { PromptTemplate } = require("@langchain/core/prompts");
const { StructuredOutputParser } = require("langchain/output_parsers");
const { RunnableSequence } = require("@langchain/core/runnables");

dotenv.config();

app.use(express.json());

// Initialize Slack app
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN, // Bot User OAuth Token
  signingSecret: process.env.SLACK_SIGNING_SECRET, // Signing Secret
  socketMode: true, // Enable Socket Mode
  appToken: process.env.SLACK_APP_TOKEN, // App-Level Token
});

// Initialize LangChain models
const openaiModel = new HuggingFaceInference({
  model: "mistralai/Mistral-7B-Instruct-v0.2", // Your HF model
  apiKey: process.env.HUGGING_FACE_API_KEY, // Your Hugging Face API Key
  temperature: 0.1,
});

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
  groupBy: z.enum(["user", "day", "category"]).optional(),
  limit: z.number().optional(),
  filters: z.record(z.string(), z.any()).optional(),
});

// Create parsers from schemas
const categoryParser = StructuredOutputParser.fromZodSchema(categorySchema);
const detailsParser = StructuredOutputParser.fromZodSchema(detailsSchema);
const queryParser = StructuredOutputParser.fromZodSchema(queryParserSchema);

// Create prompt templates
const classificationPrompt = PromptTemplate.fromTemplate(
  `You are a helpful assistant that categorizes attendance messages.
  
  Categorize the following message into exactly one of these categories:
  1. WFH (Work From Home)
  2. FULL DAY LEAVE
  3. HALF DAY LEAVE
  4. LATE TO OFFICE
  5. LEAVING EARLY
  
  Message: {message}
  
  {format_instructions}`
);

const detailsPrompt = PromptTemplate.fromTemplate(
  `You are the Chief Attendance Manager at a Fortune 500 global enterprise with strict compliance requirements. Your critical responsibility is to accurately track EVERY detail of employee attendance with 100% precision. Millions of dollars in payroll and regulatory compliance depend on your accurate interpretation of employee messages.

  Today's date is ${format(new Date(), "yyyy-MM-dd")}.
  
  ANALYZE THIS MESSAGE WITH EXTREME PRECISION: {message}
  
  CRITICAL ATTENDANCE TRACKING RULES:
  1. READ THE ENTIRE MESSAGE FIRST before extracting any information
  2. Your PRIMARY DUTY is to determine EXACTLY when an employee will be absent/present and for how long
  3. The company has a ZERO-TOLERANCE policy for attendance tracking errors
  4. Dates must be EXACT to the day - no approximations allowed
  5. Duration must be accurately calculated in days
  
  TIME UNIT CONVERSION CHART:
  - 1 hour = 0.125 days (for partial day calculations)
  - 1 day = 1 day
  - 1 week = 7 days
  - 1 month = 30 days (standard company policy)
  - 1 quarter = 90 days
  - 1 year = 365 days
  - 1 decade = 3650 days
  
  DATE REFERENCE POINTS:
  - "today" = ${format(new Date(), "yyyy-MM-dd")}
  - "tomorrow" = ${format(addDays(new Date(), 1), "yyyy-MM-dd")}
  - "next week" = ${format(
    addDays(new Date(), 7),
    "yyyy-MM-dd"
  )} (starting date)
  - "next month" = starting on the 1st of next month
  - "next quarter" = starting on the 1st of next quarter
  
  DURATION CALCULATION PROTOCOL:
  1. ALWAYS calculate endDate = startDate + (durationDays - 1)
  2. For "X days" → durationDays = X
  3. For "X weeks" → durationDays = X * 7
  4. For "X months" → durationDays = X * 30
  5. For "X years" → durationDays = X * 365
  6. For "X hours" → durationDays = 1 (same day)
  
  ATTENDANCE SCENARIOS AND REQUIRED OUTPUTS:
  
  SCENARIO 1: MULTI-DAY WORK FROM HOME
  Example: "I'll work from home for four days from tomorrow"
  ✓ isWorkingFromHome: true
  ✓ isLeaveRequest: false
  ✓ startDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [tomorrow]
  ✓ durationDays: 4
  ✓ endDate: ${format(
    addDays(new Date(), 4),
    "yyyy-MM-dd"
  )} [startDate + (durationDays - 1)]
  
  SCENARIO 2: SINGLE DAY LEAVE
  Example: "Taking half day leave tomorrow"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [tomorrow]
  ✓ durationDays: 1
  ✓ endDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [same as startDate]
  
  SCENARIO 3: LEAVE WITH SPECIFIC DATES
  Example: "I'll be on leave from March 25 to March 30"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: 2025-03-25
  ✓ endDate: 2025-03-30
  ✓ durationDays: 6 [calculated from date range]
  
  SCENARIO 4: LEAVE WITH DURATION IN WEEKS
  Example: "Taking leave for 2 weeks starting next Monday"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: [next Monday's date]
  ✓ durationDays: 14
  ✓ endDate: [startDate + 13 days]
  
  SCENARIO 5: HOURS-BASED TIMING
  Example: "Coming in 2 hours late tomorrow"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: false
  ✓ isRunningLate: true
  ✓ startDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [tomorrow]
  ✓ durationDays: 1
  ✓ endDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [same as startDate]
  
  REQUIRED ATTENDANCE FIELDS:
  - isWorkingFromHome: [true/false] - Is the employee working remotely?
  - isLeaveRequest: [true/false] - Is this a request for time off?
  - isRunningLate: [true/false] - Will the employee arrive late?
  - isLeavingEarly: [true/false] - Will the employee depart early?
  - reason: [string or null] - Stated reason for absence/WFH
  - startDate: [YYYY-MM-DD] - MUST NEVER BE NULL
  - durationDays: [number] - MUST NEVER BE NULL, minimum 1 for any request
  - endDate: [YYYY-MM-DD] - MUST NEVER BE NULL, calculated as startDate + (durationDays - 1)
  
  CRITICAL HR COMPLIANCE REQUIREMENT:
  If the end date would be after the start date, or if the message mentions a duration (e.g., "for X days"), you MUST calculate and provide the correct end date. Failure to do so would violate company policy and could result in payroll errors.
  
  {format_instructions}`
);

const queryPrompt = PromptTemplate.fromTemplate(
  `You are a helpful assistant that translates natural language queries about attendance data into a structured JSON format that will be used to construct Supabase SQL queries.
  
  The database is in Supabase using PostgreSQL. It has a table called 'leave-table' with columns: 
  id, user_id, user_name, timestamp, message, category, is_working_from_home, 
  is_leave_requested, is_coming_late, is_leave_early, first_name, last_name, email.
  
  Valid categories are: wfh, full_leave, half_leave, leave_early, come_late.
  
  IMPORTANT: When a user asks about "leaves" or "leave" without specifying a category, use "all" as the category value to indicate all leave types should be included.
  
  When interpreting timeframes:
  - "today" refers to the current date
  - "this week" refers to the current calendar week
  - "this month" refers to the current calendar month
  - "this quarter" refers to the current calendar quarter
  - Date ranges should be in ISO format (YYYY-MM-DD)
  
  Query: {query}
  
  IMPORTANT: Your response must be a valid JSON object with ONLY the following structure:
  {{
    "queryType": "count", // or "list", "trend", "summary"
    "category": "all", // Use "all" for all leave types, or one of: wfh, full_leave, half_leave, leave_early, come_late
    "timeFrame": "month", // or "day", "week", "quarter", or {{start: "2023-01-01", end: "2023-01-31"}}
    "groupBy": "user", // optional, one of "user", "day", "category"
    "limit": 10, // optional
    "filters": {{}} // optional, can include user_id, user_name, first_name, etc.
  }}
  
  Do not include any explanations or additional text. Respond ONLY with the valid JSON object.
  
  {format_instructions}`
);

// We've created three AI processing chains:

// classificationChain: Categorizes messages into attendance types
// detailsChain: Extracts detailed information from messages
// queryChain: Translates natural language queries into structured database queries

// Create the classification chain using the new approach
const classificationChain = RunnableSequence.from([
  {
    message: (input) => input.message,
    format_instructions: () => categoryParser.getFormatInstructions(),
  },
  classificationPrompt,
  openaiModel,
  categoryParser,
]);

const queryChain = RunnableSequence.from([
  {
    query: (input) => input.query,
    format_instructions: () => queryParser.getFormatInstructions(),
  },
  queryPrompt,
  openaiModel,
  queryParser,
]);

// Create the details extraction chain
const detailsChain = RunnableSequence.from([
  {
    message: (input) => input.message,
    format_instructions: () => detailsParser.getFormatInstructions(),
  },
  detailsPrompt,
  openaiModel,
  detailsParser,
]);

// Slack event listenere
// Listen for messages in channels the bot is added to
slackApp.event("message", async ({ event, client }) => {
  try {
    // Only process messages from actual users (not bots)
    if (event.subtype === undefined && event.bot_id === undefined) {
      // Get user info
      const userInfo = await client.users.info({
        user: event.user,
      });

      // Extract user details
      const userName = userInfo.user.real_name;
      const firstName = userInfo.user.profile.first_name || "";
      const lastName = userInfo.user.profile.last_name || "";
      const email = userInfo.user.profile.email || "";

      // Classify message category
      const classificationResult = await classificationChain.invoke({
        message: event.text,
      });

      const { category, confidence } = classificationResult;

      // Get additional details with improved prompt
      const detailsResult = await detailsChain.invoke({
        message: event.text,
      });

      console.log("Extracted details:", detailsResult);

      // Store in database with the complete detailsResult
      await storeAttendanceData({
        userId: event.user,
        userName: userName,
        firstName: firstName,
        lastName: lastName,
        email: email,
        timestamp: event.ts,
        message: event.text,
        category,
        confidence,
        channelId: event.channel,
        detailsResult: detailsResult, // Pass the entire object
      });
    }
  } catch (error) {
    logger.error(`Error processing message: ${error}`);
  }
});
// Slack slash command for queries
slackApp.command("/leave-table", async ({ command, ack, respond }) => {
  await ack();

  try {
    // Process query with LangChain
    const queryResult = await queryChain.invoke({
      query: command.text,
    });

    // Execute the query
    const result = await executeQuery(queryResult);
    await respond(result);
  } catch (error) {
    logger.error(`Error processing query: ${error}`);
    await respond("Sorry, I couldn't process that query. Please try again.");
  }
});

async function storeAttendanceData(data) {
  try {
    // Map the category directly from LLM output
    const mappedCategory = mapAttendanceCategory(data.category);

    // Ensure detailsResult values are accessed correctly
    const {
      startDate,
      endDate,
      isWorkingFromHome,
      isLeaveRequest,
      isRunningLate,
      isLeavingEarly,
    } = data.detailsResult;

    // Log the extracted date information for debugging
    console.log("Extracted date info:", {
      startDate,
      endDate,
      message: data.message,
    });

    // Prepare user data
    const userData = {
      user_id: data.userId,
      user_name: data.userName,
      timestamp: new Date(parseInt(data.timestamp) * 1000).toISOString(),
      message: data.message,
      category: mappedCategory,
      is_working_from_home: isWorkingFromHome,
      is_leave_requested: isLeaveRequest,
      is_coming_late: isRunningLate,
      is_leave_early: isLeavingEarly,
      first_name: data.firstName || null,
      last_name: data.lastName || null,
      email: data.email || null,
      start_date: startDate,
      end_date: endDate,
    };

    console.log("Inserting data into Supabase:", userData);

    // Store in database
    const { error } = await supabase.from("leave-table").insert([userData]);

    if (error) {
      console.error("Database error:", error);
      throw error;
    }

    const timestampDate = new Date(parseInt(data.timestamp) * 1000);
    const formattedDate = format(timestampDate, "dd-MMM-yyyy");

    // Create detailed log entry
    let logEntry = `${formattedDate} - ${userData.user_name} - ${userData.category} - "${userData.message}"`;
    if (startDate) {
      logEntry += ` (Start: ${startDate}${endDate ? `, End: ${endDate}` : ""})`;
    }

    // Log the detailed information
    logger.info(`Attendance record: ${logEntry}`);

    console.log("Data successfully stored in database");
  } catch (error) {
    console.error("Error storing data:", error);
    throw error;
  }
}

function mapAttendanceCategory(category) {
  const categoryMap = {
    WFH: "wfh",
    "WORK FROM HOME": "wfh",
    "FULL DAY LEAVE": "full_leave",
    "HALF DAY LEAVE": "half_leave",
    "LATE TO OFFICE": "come_late",
    "LEAVING EARLY": "leave_early",
  };

  return categoryMap[category.toUpperCase()] || "wfh";
}

// Modify the executeQuery function to better handle "all leaves" queries
async function executeQuery(params) {
  try {
    let query = supabase.from("leave-table").select("*");

    console.log("Query parameters:", params);

    // Handle time frame
    if (params.timeFrame) {
      const { start, end } = calculateTimeRange(params.timeFrame);
      query = query.gte("timestamp", start).lte("timestamp", end);
    }

    // Handle category filtering
    if (params.category) {
      if (params.category === "all") {
        // Don't add any category filter if "all" is specified
        // This will return all records that match the other criteria
      } else {
        // Apply specific category filter
        query = query.eq("category", params.category);
      }
    }

    // Add additional filters if present
    if (params.filters && Object.keys(params.filters).length > 0) {
      Object.entries(params.filters).forEach(([key, value]) => {
        if (key && value) {
          query = query.eq(key, value);
        }
      });
    }

    // Apply limit if specified
    if (params.limit) {
      query = query.limit(params.limit);
    }

    console.log("Final query:", query);

    // Execute query
    const { data, error } = await query;

    if (error) {
      console.error("Query execution error:", error);
      throw error;
    }

    console.log(`Query returned ${data.length} records`);

    // Format results based on query type
    switch (params.queryType) {
      case "count":
        if (params.groupBy === "user") {
          const userCounts = {};
          data.forEach((record) => {
            userCounts[record.user_name] =
              (userCounts[record.user_name] || 0) + 1;
          });
          return formatCountResponse(userCounts, params);
        } else {
          return `Found ${data.length} records matching your query.`;
        }
      case "list":
        return formatListResponse(data, params);
      case "trend":
        return formatTrendResponse(data, params);
      case "summary":
        return formatSummaryResponse(data, params);
      default:
        return `Found ${data.length} records matching your query.`;
    }
  } catch (error) {
    console.error("Error in executeQuery:", error);
    return `Sorry, I encountered an error processing your query: ${error.message}`;
  }
}

// Helper function to calculate date ranges
function calculateTimeRange(timeFrame) {
  const now = new Date();
  let start,
    end = new Date();

  if (typeof timeFrame === "object" && timeFrame.start && timeFrame.end) {
    return {
      start: new Date(timeFrame.start).toISOString(),
      end: new Date(timeFrame.end).toISOString(),
    };
  }

  switch (timeFrame) {
    case "day":
      start = new Date(now.setHours(0, 0, 0, 0));
      break;
    case "week":
      start = new Date(now);
      start.setDate(now.getDate() - 7);
      break;
    case "month":
      start = new Date(now);
      start.setMonth(now.getMonth() - 1);
      break;
    case "quarter":
      start = new Date(now);
      start.setMonth(now.getMonth() - 3);
      break;
    default:
      start = new Date(now);
      start.setDate(now.getDate() - 7); // Default to last week
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

// Format response functions are kept the same
function formatCountResponse(counts, params) {
  if (Object.keys(counts).length === 0) return "No matching records found.";

  const category = params.category || "attendance records";
  const timeFrame = formatTimeFrameText(params.timeFrame);

  const sortedUsers = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, params.limit || 5);

  let response = `*${category.toUpperCase()} Summary for ${timeFrame}*\n\n`;

  sortedUsers.forEach(([user, count], index) => {
    response += `${index + 1}. ${user}: ${count} ${
      count === 1 ? "time" : "times"
    }\n`;
  });

  return response;
}

function formatListResponse(data, params) {
  if (data.length === 0) return "No matching records found.";

  const category = params.category || "attendance records";
  const timeFrame = formatTimeFrameText(params.timeFrame);
  const limit = params.limit || 10;

  let response = `*${category.toUpperCase()} Records for ${timeFrame}*\n\n`;

  data.slice(0, limit).forEach((record, index) => {
    const date = new Date(record.timestamp).toLocaleDateString();
    response += `${index + 1}. ${record.user_name} - ${date}: "${
      record.message
    }"\n`;
  });

  if (data.length > limit) {
    response += `\n_...and ${data.length - limit} more records_`;
  }

  return response;
}

function formatTrendResponse(data, params) {
  if (data.length === 0) return "No data available for trend analysis.";

  const category = params.category || "attendance records";
  const timeFrame = formatTimeFrameText(params.timeFrame);

  // Group data by day
  const dailyData = {};
  data.forEach((record) => {
    const day = new Date(record.timestamp).toISOString().split("T")[0];
    dailyData[day] = (dailyData[day] || 0) + 1;
  });

  // Sort days for display
  const sortedDays = Object.keys(dailyData).sort();

  // Find max count for scaling
  const maxCount = Math.max(...Object.values(dailyData));
  const scaleFactor = maxCount > 10 ? 10 / maxCount : 1;

  let response = `*${category.toUpperCase()} Trend for ${timeFrame}*\n\n`;

  sortedDays.forEach((day) => {
    const count = dailyData[day];
    const bars = "█".repeat(Math.ceil(count * scaleFactor));
    const formattedDay = new Date(day).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    response += `${formattedDay}: ${bars} (${count})\n`;
  });

  return response;
}

function formatSummaryResponse(data, params) {
  if (data.length === 0) return "No data available for summary.";

  const timeFrame = formatTimeFrameText(params.timeFrame);

  // Count by category
  const categoryCounts = {};
  data.forEach((record) => {
    const category = record.category;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  });

  // Count by user
  const userCounts = {};
  data.forEach((record) => {
    const user = record.user_name;
    userCounts[user] = (userCounts[user] || 0) + 1;
  });

  // Find top users
  const topUsers = Object.entries(userCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  let response = `*Attendance Summary for ${timeFrame}*\n\n`;

  response += "*By Category:*\n";
  for (const [category, count] of Object.entries(categoryCounts)) {
    const prettyCategory =
      {
        wfh: "Work From Home",
        full_leave: "Full Day Leave",
        half_leave: "Half Day Leave",
        come_late: "Late to Office",
        leave_early: "Leaving Early",
      }[category] || category;

    response += `• ${prettyCategory}: ${count}\n`;
  }

  response += "\n*Top Users:*\n";
  topUsers.forEach(([user, count], index) => {
    response += `${index + 1}. ${user}: ${count} ${
      count === 1 ? "record" : "records"
    }\n`;
  });

  response += `\n*Total Records:* ${data.length}`;

  return response;
}

function formatTimeFrameText(timeFrame) {
  if (typeof timeFrame === "object" && timeFrame.start && timeFrame.end) {
    const start = new Date(timeFrame.start).toLocaleDateString();
    const end = new Date(timeFrame.end).toLocaleDateString();
    return `${start} to ${end}`;
  }

  switch (timeFrame) {
    case "day":
      return "Today";
    case "week":
      return "This Week";
    case "month":
      return "This Month";
    case "quarter":
      return "This Quarter";
    default:
      return "Selected Period";
  }
}

app.listen(8000, () => {
  console.log("Server is running on port 8000");
});

// Add this function to test your database connection
async function testDatabaseConnection() {
  try {
    // Try a simple query
    const { data, error } = await supabase
      .from("leave-table")
      .select("*")
      .limit(1);

    if (error) {
      console.error("Database test query error:", error);
      return false;
    }

    console.log("Database connection successful. Sample data:", data);
    return true;
  } catch (err) {
    console.error("Database connection test failed:", err);
    return false;
  }
}

(async () => {
  await slackApp.start();
  console.log("Slack Bolt app is running");

  const dbConnected = await testDatabaseConnection();
  if (dbConnected) {
    console.log("Database connection verified successfully");
  } else {
    console.log("WARNING: Database connection issue detected");
  }
})();
