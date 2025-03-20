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

  Start date should be extracted based on the user's timezone.
  
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

  Rules and Guidelines:
1. All times must be in IST.
2. If the event falls on a Sunday, set 'is_valid' to false.
3. For FDL requests:
   - If sent before 9:00 AM or after 6:00 PM on weekdays, assume leave is for the next working day.
   - If sent on Saturday after 1:00 PM or on Sunday, assume leave is for Monday (or next working day) unless explicitly mentioned otherwise.
4. Time references:
   - After 6:00 PM: Interpret as an event for the next working day.
   - Before 9:00 AM: Assume the event is for the same day.
   - Single time reference (e.g., "11"): Assume 11:00 AM.
5. When time is not specified:
   - No start time: Use current timestamp as start time.
   - No end time: Assume 6:00 PM on weekdays or 1:00 PM on Saturday.
   - No duration: Assume full-day leave.
6. LTO (Late to Office):
   - Start time: 9:00 AM
   - End time: Specified arrival time
   - Duration: Difference between start and end time
7. LE (Leaving Early):
   - Start time: Specified leaving time
   - End time: 6:00 PM (weekdays) or 1:00 PM (Saturday)
   - Duration: Difference between start and end time
   - If between 1 PM and 2 PM on weekdays, categorize as HDL
   - If at or after 6 PM (in context of today or time not specified), set 'is_valid' to false
8. WFH:
   - "WFH today" is not a leave request
   - Specify duration if mentioned (e.g., "WFH till 11 AM" is 9:00 AM to 11:00 AM)
9. Multiple events: Split into separate objects unless explicitly related
10. Past leaves: If less than 6 months in the past, set 'is_valid' to false
11. OOO requests after 6 PM or before 9 AM: Set 'is_valid' to false

Analysis Process:
1. Read the message carefully and quote relevant parts.
2. Determine if the message is leave-related.
3. If leave-related, extract and list relevant details (category, times, duration, reason).
4. Consider possible categories and explain why you choose or reject each.
5. Apply the rules and guidelines to categorize and validate the request, explaining your reasoning.
6. Format the response according to the specified JSON structure.

Please provide your analysis and response in the following format:

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
  `You are an expert assistant that converts natural language queries about attendance into precise Supabase query JSON. Follow these rules:

  # Important: Always use the current year (2025) for all date operations unless a specific year is mentioned.

# Database Schema
Table: 'leave-table'
Columns:
- id, user_id, user_name, timestamp (record creation time)
- start_date (timestamptz), end_date (timestamptz) - leave period in UTC
- category: wfh, full_leave, half_leave, leave_early, come_late
- Status flags: is_working_from_home, is_leave_requested, is_coming_late, is_leave_early
- User details: first_name, last_name, email

# Critical Time Handling (IST to UTC Conversion)
- All dates in DB are UTC timestamptz
- Date conversion rules:
  1. User mentions "27 March" = 27 Mar 00:00-23:59 IST 
  2. Convert to UTC:
     - Start: 26 Mar 18:30 UTC
     - End: 27 Mar 18:29:59 UTC
  3. Create filter: 
     start_date <= 27 Mar 18:29:59 UTC 
     AND end_date >= 26 Mar 18:30 UTC

# Query Analysis Guide
1. Identify: 
   - queryType (list/count/trend)
   - Leave category (map terms:
     - "leave" → full_leave
     - "half day" → half_leave
     - "WFH" → wfh
     - "late" → come_late
     - "early departure" → leave_early)
2. Date ranges:
   - Convert user dates to UTC ranges using above rules
   - For multi-day leaves, check date overlap
3. Filters:
   - Use start_date/end_date for leave period filters
   - Use timestamp for record creation time filters

# Examples

  Example 1: "Who took leave on March 27th?"
  {{
    "queryType": "list",
    "category": "all",
    "timeFrame": {{"start": "2023-03-26T18:30:00Z", "end": "2023-03-27T18:29:59Z"}},
    "filters": {{
      "start_date": {{"lte": "2023-03-27T18:29:59Z"}},
      "end_date": {{"gte": "2023-03-26T18:30:00Z"}}
    }},
    "groupBy": "user",
    "limit": 50
  }}

Example 1: "Who took leave on March 27th?"
{{
  "queryType": "list",
  "category": "all",
  "timeFrame": {{"start": "2023-03-26T18:30:00Z", "end": "2023-03-27T18:29:59Z"}},
  "filters": {{
    "start_date": {{"lte": "2023-03-27T18:29:59Z"}},
    "end_date": {{"gte": "2023-03-26T18:30:00Z"}}
  }},
  "groupBy": "user",
  "limit": 50
}}

Example 2: "Late arrivals last month"
{{
  "queryType": "trend",
  "category": "come_late",
  "timeFrame": "month",
  "filters": {{
    "is_coming_late": true,
    "start_date": {{"gte": "2023-02-01T18:30:00Z"}}
  }},
  "groupBy": "user"
}}

# Current Query
Query: {query}

Generate JSON response with EXACTLY this structure (ONLY JSON, NO TEXT BEFORE/AFTER):
{{
  "queryType": "count|list|trend|summary",
  "category": "all|wfh|full_leave|half_leave|leave_early|come_late",
  "timeFrame": "day|week|month|quarter|{{\"start\":\"ISO_DATE\",\"end\":\"ISO_DATE\"}}",
  "groupBy": "user_id|user_name|day|category",
  "limit": 10,
  "filters": {{
    "start_date": {{\"gte?\": \"ISO_DATE\", \"lte?\": \"ISO_DATE\"}},
    "end_date": {{\"gte?\": \"ISO_DATE\", \"lte?\": \"ISO_DATE\"}},
    "user_id?": "value",
    "user_name?": "value"
  }}
}}

ONLY respond with valid JSON. No code blocks, no explanations, no markdown formatting.
`
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

function formatResponse(data) {
  return data
    .map((record) => {
      const startDate = new Date(record.start_date).toLocaleDateString(
        "en-IN",
        {
          timeZone: "Asia/Kolkata",
          day: "numeric",
          month: "short",
          year: "numeric",
        }
      );

      const endDate = new Date(record.end_date).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      return `👤 *${
        record.user_name || record.first_name + " " + record.last_name
      }*
📅 Dates: ${startDate} - ${endDate}
🏷️ Type: ${formatCategory(record.category)}
📝 ${record.message || "No message provided"}`;
    })
    .join("\n\n");
}

function formatCategory(category) {
  const categoryMap = {
    wfh: "Work From Home",
    full_leave: "Full Day Leave",
    half_leave: "Half Day Leave",
    leave_early: "Leave Early",
    come_late: "Coming Late",
  };
  return categoryMap[category] || category;
}
// Slack slash command for queries
slackApp.command("/leave-table", async ({ command, ack, respond }) => {
  await ack();

  try {
    const queryResult = await queryChain.invoke({ query: command.text });
    console.log("queryresulttttt", queryResult);

    // Use proper column names from your schema
    const queryParams = {
      queryType: queryResult.queryType || "list",
      category: queryResult.category || "all",
      timeFrame: queryResult.timeFrame || "day",
      groupBy: queryResult.groupBy || "user",
      limit: queryResult.limit || 10,
      filters: {
        // Use the actual start_date and end_date filters from LLM output
        start_date: queryResult.filters?.start_date || {},
        end_date: queryResult.filters?.end_date || {},
        // Include timestamp only if needed for record creation time
        timestamp: {
          gte: queryResult.timeFrame?.start,
          lte: queryResult.timeFrame?.end,
        },
      },
    };

    console.log("Final query parameters:", queryParams);

    const { data, error } = await supabase
      .from("leave-table")
      .select("*")
      // Use start_date and end_date for leave period filtering
      .lte("start_date", queryParams.filters.timestamp.lte) // Leave starts on or before end of range
      .gte("end_date", queryParams.filters.timestamp.gte) // Leave ends on or after start of range
      .limit(queryParams.limit);

    if (error) throw error;

    await respond(
      data.length > 0 ? formatResponse(data) : "No matching records found"
    );
  } catch (error) {
    console.error("Query execution error:", error);
    await respond(`⚠️ Error: ${error.message.split("\n")[0]}`);
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

    // ✅ Use the correct timestamps from params.filters.timestamp
    if (params.filters?.timestamp) {
      const { gte, lte } = params.filters.timestamp;
      if (gte && lte) {
        query = query.gte("timestamp", gte).lte("timestamp", lte);
      }
    }

    // Handle category filtering
    if (params.category) {
      if (params.category !== "all") {
        query = query.eq("category", params.category);
      }
    }

    // Add additional filters if present
    if (params.filters) {
      Object.entries(params.filters).forEach(([key, value]) => {
        if (key !== "timestamp" && value) {
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
