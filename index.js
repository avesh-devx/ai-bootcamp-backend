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
const {
  formatResponse,
  mapAttendanceCategory,
  formatCountResponse,
  formatListResponse,
  formatTrendResponse,
  formatSummaryResponse,
} = require("./src/utils/common");

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
const aiModel = new HuggingFaceInference({
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
  aiModel,
  categoryParser,
]);

const queryChain = RunnableSequence.from([
  {
    query: (input) => input.query,
    format_instructions: () => queryParser.getFormatInstructions(),
  },
  queryPrompt,
  aiModel,
  queryParser,
]);

// Create the details extraction chain
const detailsChain = RunnableSequence.from([
  {
    message: (input) => input.message,
    format_instructions: () => detailsParser.getFormatInstructions(),
  },
  detailsPrompt,
  aiModel,
  detailsParser,
]);

// Slack event listenere
// Listen for messages in channels the bot is added to
slackApp.event("message", async ({ event, client }) => {
  try {
    // Process regular messages
    if (event.subtype === undefined && event.bot_id === undefined) {
      await processAttendanceMessage(event, client);
    }
    // Process edited messages
    else if (
      event.subtype === "message_changed" &&
      event.bot_id === undefined
    ) {
      // The edited message is in event.message
      const editedEvent = {
        ...event.message,
        channel: event.channel,
        // Use the original ts as the edit reference
        original_ts: event.previous_message?.ts,
        // But keep track that this is an edit
        is_edit: true,
      };
      await processAttendanceMessage(editedEvent, client);
    }
  } catch (error) {
    logger.error(`Error processing message: ${error}`);
  }
});

// Separate function to process attendance messages (new or edited)
async function processAttendanceMessage(event, client) {
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

  // Get additional details
  const detailsResult = await detailsChain.invoke({
    message: event.text,
  });

  console.log("Extracted details:", detailsResult);

  // Check for existing attendance records and handle accordingly
  await handleAttendanceRecord({
    userId: event.user,
    userName: userName,
    firstName: firstName,
    lastName: lastName,
    email: email,
    timestamp: event.ts,
    originalTs: event.original_ts, // Will be undefined for new messages
    isEdit: event.is_edit || false,
    message: event.text,
    category,
    confidence,
    channelId: event.channel,
    detailsResult: detailsResult,
  });
}

async function handleAttendanceRecord(data) {
  try {
    const {
      startDate,
      endDate,
      isWorkingFromHome,
      isLeaveRequest,
      isRunningLate,
      isLeavingEarly,
    } = data.detailsResult;

    // Prepare user data
    const userData = {
      user_id: data.userId,
      user_name: data.userName,
      timestamp: new Date(parseInt(data.timestamp) * 1000).toISOString(),
      message: data.message,
      category: mapAttendanceCategory(data.category),
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

    // First check if this is an edit of an existing message
    if (data.isEdit && data.originalTs) {
      // Look up the record by original timestamp
      const { data: existingRecord, error: lookupError } = await supabase
        .from("leave-table")
        .select("id")
        .eq("user_id", data.userId)
        .eq(
          "timestamp",
          new Date(parseInt(data.originalTs) * 1000).toISOString()
        )
        .single();

      if (existingRecord && !lookupError) {
        // Update the existing record
        const { error: updateError } = await supabase
          .from("leave-table")
          .update(userData)
          .eq("id", existingRecord.id);

        if (updateError) throw updateError;
        console.log("Updated existing record based on message edit");
        return;
      }
    }

    // Check for overlapping records (even for new messages)
    // This is for the case where user posts a new message replacing an earlier one
    if (startDate && endDate) {
      const { data: overlappingRecords, error: overlapError } = await supabase
        .from("leave-table")
        .select("id")
        .eq("user_id", data.userId)
        .lte("start_date", endDate)
        .gte("end_date", startDate);

      if (
        overlappingRecords &&
        overlappingRecords.length > 0 &&
        !overlapError
      ) {
        // Update the most recent overlapping record
        const mostRecentRecord = overlappingRecords[0];
        const { error: updateError } = await supabase
          .from("leave-table")
          .update(userData)
          .eq("id", mostRecentRecord.id);

        if (updateError) throw updateError;
        console.log("Updated existing record based on date overlap");

        // If there are multiple overlapping records, we might want to delete them
        if (overlappingRecords.length > 1) {
          const idsToDelete = overlappingRecords.slice(1).map((r) => r.id);
          const { error: deleteError } = await supabase
            .from("leave-table")
            .delete()
            .in("id", idsToDelete);

          if (deleteError) {
            console.error("Error deleting redundant records:", deleteError);
          } else {
            console.log(
              `Deleted ${idsToDelete.length} redundant overlapping records`
            );
          }
        }

        return;
      }
    }

    // If we get here, it's a new record with no overlaps
    const { error } = await supabase.from("leave-table").insert([userData]);

    if (error) {
      console.error("Database error:", error);
      throw error;
    }

    console.log("New attendance record created");
  } catch (error) {
    console.error("Error handling attendance record:", error);
    throw error;
  }
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
