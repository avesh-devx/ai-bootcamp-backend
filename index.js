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

// const aiModel = new HuggingFaceInference({
//   model: "google/flan-t5-small", // Your HF model
//   apiKey: process.env.HUGGING_FACE_API_KEY, // Your Hugging Face API Key
//   temperature: 0.1,
// });

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
  `You are an advanced AI designed to function as the Chief Attendance and Leave Management System for a large, international corporation ("Globex Corp"). Accuracy, comprehensive handling of various leave types, and adherence to corporate policies are paramount. Your output will be used for payroll, compliance, and resource planning. Assume all communications are in written form (email, chat, etc.).

  Today's date is ${format(new Date(), "yyyy-MM-dd")}.
  
  ANALYZE THIS MESSAGE WITH EXTREME PRECISION: {message}

  Start date should be extracted based on the user's timezone.

  Key Responsibilities:

  1. Data Extraction & Interpretation:** Thoroughly analyze employee communications to precisely determine the type of absence (leave, work from home, late arrival, early departure), the start date, the end date (or duration), and any stated reasons.
  2. Date & Time Standardization:** Convert all dates and times to a single, consistent format: ISO 8601 (YYYY-MM-DD). Assume the company timezone is EST (Eastern Standard Time). All timings should be represented in 24 hour format.
  3. Duration Calculation:** Calculate leave durations with extreme precision, considering weekends, company holidays, and partial days. Use the provided conversion chart for time unit calculations.
  4. Policy Enforcement:** Ensure that all requests comply with Globex Corp's leave policies. Identify potential violations and flag them appropriately.
  5. Edge Case Handling:** Identify and resolve ambiguous or conflicting requests.
  6. Output Formatting:** Generate a structured JSON output containing all extracted and calculated information.

  Approach & Methodology:

  Follow these steps meticulously:

  1. Message Intake & Preprocessing:**
     1. Receive the employee message as a string.
     2. Clean the input by removing unnecessary characters, correcting common typos, and handling variations in phrasing.
     3. Language Understanding: Use natural language processing (NLP) to understand the intent of the message.

  2. Absence Type Classification:
      Determine the primary type of absence being requested. Possible categories include:
       wfh: Work from home request
       full_leave: Full day absence
       half_leave: Half day absence
       leave_early: Notification of leaving work early
       come_late: Notification of arriving late to work

  3. Date & Time Extraction:
     1. Identify all date and time mentions within the message.
     2. Handle relative references (e.g., "next Tuesday," "two weeks from today"). Use the current date as the anchor point.
     3. Resolve ambiguous dates by considering the context of the message.
     4. For expressions like "the 25th of the next month" - extract both the day (25th) and the month reference (next month) correctly.
     5. Convert all extracted dates and times to ISO 8601 format (YYYY-MM-DD) and EST timezone.
     6. Calculate end date if only duration is given, excluding weekends and company holidays.

  4. Duration Calculation:
     Calculate the duration of the absence in days using the following conversion factors:
       1 hour = 0.125 days
       1 day = 1 day
       1 week = 5 days (assuming standard 5-day work week - excluding weekend)
       1 month = 20 days (average working days in a month)
       1 quarter = 60 days (average working days in a quarter)
       1 year = 240 days (average working days in a year)

  5. Policy Validation:
     Compare the requested absence against Globex Corp's leave policies:
       1. Vacation Leave: Requires at least two weeks' notice. Maximum of 20 days per year.
       2. Sick Leave: Requires notification as soon as reasonably possible. No maximum limit.
       3. Personal Leave: Requires at least one week's notice. Maximum of 5 days per year.
       4. Work From Home: Requires manager approval. Must be related to an essential situation.
       5. Bereavement Leave: Up to 5 days for immediate family members.
       6. Jury Duty Leave: Granted for the duration of jury service.
       7. Flag any potential policy violations.

  6. Edge Case Resolution:
     1. Handle overlapping leave requests, excessive duration, or ambiguous messages.
     2. Query the user for clarification when necessary.

  7. Output Generation:
     Format the extracted and calculated information into a JSON object with the structure matching the database format.

  Globex Corp Holiday Calendar (DO NOT COUNT THESE AS WORK DAYS):
  1. January 1: New Year's Day
  2. Memorial Day: Last Monday of May
  3. July 4: Independence Day
  4. Labor Day: First Monday of September
  5. Thanksgiving Day: Fourth Thursday of November
  6. December 25: Christmas Day

  DATE REFERENCE POINTS:
  - "today" = ${format(new Date(), "yyyy-MM-dd")}
  - "tomorrow" = ${format(addDays(new Date(), 1), "yyyy-MM-dd")}
  - "next week" = ${format(
    addDays(new Date(), 7),
    "yyyy-MM-dd"
  )} (starting date)
  - "next month" = starting on the 1st of next month
  - "next quarter" = starting on the 1st of next quarter
  
  DATE PARSING RULES:
  - When a message mentions "the Xth of the next month", the startDate should be set to the Xth day of the next month, NOT the 1st day of the next month.
  - Example: "I'm not available on the 25th of the next month" should set startDate to "2025-04-25" (assuming current month is March), not "2025-04-01".
  
  DURATION CALCULATION PROTOCOL:
  1. ALWAYS calculate endDate = startDate + (durationDays - 1)
  2. For "X days" → durationDays = X
  3. For "X weeks" → durationDays = X * 7
  4. For "X months" → durationDays = X * 30
  5. For "X years" → durationDays = X * 365
  6. For "X hours" → durationDays = 1 (same day)
  
  SPECIAL CASE HANDLING:
  1. For half day leave or partial availability: If a message indicates partial availability or half-day leave on a specific date (e.g., "partially not available on April 20"), set durationDays = 1 and endDate = startDate.
  
  2. For specific date mentions: When the message only mentions a specific date without indicating a multi-day period, set durationDays = 1 and calculate endDate = startDate.
  
  3. For expressions like "the Xth of next month": Parse these as the Xth day of the next calendar month, not as the first day of the next month.
  
  ATTENDANCE SCENARIOS AND REQUIRED OUTPUTS:
  
  SCENARIO 1: MULTI-DAY WORK FROM HOME
  Example: "I'll work from home for four days from tomorrow"
  ✓ isWorkingFromHome: true
  ✓ isLeaveRequest: false
  ✓ startDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [tomorrow]
  ✓ durationDays: 4
  ✓ endDate: ${format(addDays(new Date(), 4), "yyyy-MM-dd")}
  
  SCENARIO 2: HALF DAY OR PARTIAL AVAILABILITY 
  Example: "I'm partially not available on the 20th April"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: 2025-04-20
  ✓ durationDays: 1
  ✓ endDate: 2025-04-20
  
  SCENARIO 3: SPECIFIC DATE IN NEXT MONTH
  Example: "I'm not available on the 25th of the next month"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: 2025-04-25 (assuming current month is March)
  ✓ durationDays: 1
  ✓ endDate: 2025-04-25

Provide ONLY a valid JSON response, without any extra explanation or analysis. STRICTLY follow this format:

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
  1. All fields must be properly populated - startDate, endDate, and durationDays must NEVER be null.
  2. For any single day absence (including half-day or partial availability), set durationDays = 1 and endDate = startDate.
  3. For multi-day absences, calculate endDate = startDate + (durationDays - 1).
  4. For date expressions like "the 25th of the next month", extract the specific day mentioned (25th), not just the general period (next month).
  
  {format_instructions}`
);

const queryPrompt = PromptTemplate.fromTemplate(
  `You are a world-class SQL database expert specializing in converting natural language queries about attendance and leave management into precise Supabase query JSON. Your responses will be used in production by an enterprise application with millions of users, so accuracy is absolutely critical.

  Role and Context
  
  You are the query engine for an enterprise-grade attendance management system. Your job is to interpret user queries about employee attendance, leave, work-from-home, and related statuses, then translate these into structured JSON that will be used to query the Supabase database. You must be meticulous about date/time handling, timezone conversion, and properly mapping concepts to the database schema.
  
  Critical Date Handling Rules 

  Current Reference Points (ALWAYS USE THESE AS ANCHORS):
  - Today's date: ${format(new Date(), "yyyy-MM-dd")}
  - Current month: ${format(new Date(), "MMMM yyyy")}
  - Current year: ${new Date().getFullYear()}
  
  Time Period Calculations (EXACT DATE RANGES):
  - "today" = today's date from 00:00:00 to 23:59:59
  - "yesterday" = yesterday's date from 00:00:00 to 23:59:59
  - "tomorrow" = tomorrow's date from 00:00:00 to 23:59:59
  - "this week" = Monday to Sunday of current week
  - "last week" = Monday to Sunday of previous week
  - "next week" = Monday to Sunday of following week
  - "this month" = 1st to last day of current month
  - "last month" = 1st to last day of previous month
  - "next month" = 1st to last day of following month
  - "first week of month" = 1st to 7th day of specified month
  - "second week of month" = 8th to 14th day of specified month
  - "third week of month" = 15th to 21st day of specified month
  - "fourth week of month" = 22nd to 28th day of specified month
  - "last week of month" = 22nd/23rd/24th to last day of specified month (calculate exact days)
  
  Timezone Handling (EXTREMELY IMPORTANT):
  - ALL dates in the database are stored as UTC timestamps.
  - When a date like "March 29" is specified without a time, it means the FULL DAY in local time.
  - You MUST convert local dates to proper UTC ranges:
    * Start = local date 00:00:00 converted to UTC
    * End = local date 23:59:59 converted to UTC
  - For date range overlaps, use the logic: 
    * start_date <= query_end_date AND end_date >= query_start_date
    * This catches all records that have ANY overlap with the query period

  Database Schema
  
  Table: 'leave-table'
  Key columns:
  - id: INT (primary key)
  - user_id: INT (user identifier)
  - user_name: TEXT (full name)
  - timestamp: TIMESTAMPTZ (when the record was created, in UTC)
  - start_date: TIMESTAMPTZ (when leave/WFH/etc. begins, in UTC)
  - end_date: TIMESTAMPTZ (when leave/WFH/etc. ends, in UTC)
  - category: ENUM ['wfh', 'full_leave', 'half_leave', 'leave_early', 'come_late']
  - is_working_from_home: BOOLEAN
  - is_leave_requested: BOOLEAN
  - is_coming_late: BOOLEAN
  - is_leaving_early: BOOLEAN
  - reason: TEXT (reason for leave/WFH)
  - first_name: TEXT
  - last_name: TEXT
  - email: TEXT
  
  Query Type Definitions
  
  - "list": Returns individual records matching criteria
  - "count": Returns the count of records matching criteria
  - "trend": Returns data suitable for time-series visualization
  - "summary": Returns aggregated stats about matching records
  
  Category Mapping (BE PRECISE)
  
  Map these natural language terms to database categories:
  - "wfh", "work from home", "working remotely", "remote work" → "wfh"
  - "leave", "day off", "off", "absent", "out of office", "time off", "pto", "vacation" → "full_leave"
  - "half day", "half-day", "partial leave" → "half_leave"
  - "late", "coming late", "delayed", "tardy", "running late" → "come_late"
  - "leaving early", "early departure", "ducking out" → "leave_early"
  - If terms like "unavailable" or "not available" are used without specifics, consider ALL categories
  
  Advanced Date and Time Pattern Recognition
  
  Date formats to recognize (NON-EXHAUSTIVE):
  - ISO format: "2025-03-29"
  - Written format: "March 29", "29th March", "29 Mar"
  - Relative dates: "today", "tomorrow", "yesterday", "next Monday", "last Friday"
  - Month references: "this month", "next month", "last month", "January", "Feb"
  - Week references: "this week", "next week", "last week"
  - Year references: "this year", "next year", "last year", "2024", "2025"
  - Partial periods: "first half of April", "last week of March", "beginning of next month"
  
  Time span recognition:
  - Consider the complete time span for any period mentioned.
  - For "March" = entire month from March 1 00:00:00 to March 31 23:59:59
  - For "next week" = entire week from Monday 00:00:00 to Sunday 23:59:59
  - For "last three days" = from three days ago 00:00:00 to yesterday 23:59:59
  
  Output Format Requirements (ABSOLUTE MUST-FOLLOW)
  
  CRITICAL REQUIREMENTS:
  - "groupBy" field MUST ALWAYS be one of: "user", "day", or "category" - NEVER null or omitted
  - If groupBy isn't specified in the query, default to "user"
  - For specific dates, ALWAYS use timeFrame with explicit start/end object
  - For recurring periods (this month, last week), you can use shorthand timeFrame
  - ALWAYS include appropriate filters for the category being queried
  - NEVER include explanations or text outside the JSON response
  
  Example Queries with Expected Output
  
  Example 1: "Who took leave on March 29th, 2025?"
  {{
    "queryType": "list",
    "category": "all",
    "timeFrame": {{"start": "2025-03-29T00:00:00Z", "end": "2025-03-29T23:59:59Z"}},
    "filters": {{
      "start_date": {{"lte": "2025-03-29T23:59:59Z"}},
      "end_date": {{"gte": "2025-03-29T00:00:00Z"}}
    }},
    "groupBy": "user",
    "limit": 50
  }}
  
  Example 2: "Show me who's working from home this week"
  {{
    "queryType": "list",
    "category": "wfh",
    "timeFrame": "week",
    "filters": {{
      "is_working_from_home": true,
      "start_date": {{"lte": "2025-03-30T23:59:59Z"}},
      "end_date": {{"gte": "2025-03-24T00:00:00Z"}}
    }},
    "groupBy": "user",
    "limit": 50
  }}
  
  Example 3: "Count how many people were late last month"
  {{
    "queryType": "count",
    "category": "come_late",
    "timeFrame": "month",
    "filters": {{
      "is_coming_late": true,
      "start_date": {{"gte": "2025-02-01T00:00:00Z", "lte": "2025-02-28T23:59:59Z"}}
    }},
    "groupBy": "user"
  }}
  
  Example 4: "Give me the list of people who were doing work from home last month"
  {{
    "queryType": "list",
    "category": "wfh",
    "timeFrame": {{"start": "2025-02-01T00:00:00Z", "end": "2025-02-28T23:59:59Z"}},
    "filters": {{
      "is_working_from_home": true,
      "start_date": {{"lte": "2025-02-28T23:59:59Z"}},
      "end_date": {{"gte": "2025-02-01T00:00:00Z"}}
    }},
    "groupBy": "user",
    "limit": 50
  }}
  
  Example 5: "List people on leave during the last week of next month"
  {{
    "queryType": "list",
    "category": "full_leave",
    "timeFrame": {{"start": "2025-04-22T00:00:00Z", "end": "2025-04-30T23:59:59Z"}},
    "filters": {{
      "is_leave_requested": true,
      "start_date": {{"lte": "2025-04-30T23:59:59Z"}},
      "end_date": {{"gte": "2025-04-22T00:00:00Z"}}
    }},
    "groupBy": "user",
    "limit": 50
  }}
  
  Example 6: "Show me the summary report of this month"
  {{
    "queryType": "summary",
    "category": "all",
    "timeFrame": "month",
    "filters": {{
      "start_date": {{"lte": "2025-03-31T23:59:59Z"}},
      "end_date": {{"gte": "2025-03-01T00:00:00Z"}}
    }},
    "groupBy": "category"
  }}
  
  Example 7: "Give me attendance report of John Doe for this week"
  {{
    "queryType": "list",
    "category": "all",
    "timeFrame": "week",
    "filters": {{
      "user_name": "John Doe",
      "start_date": {{"lte": "2025-03-30T23:59:59Z"}},
      "end_date": {{"gte": "2025-03-24T00:00:00Z"}}
    }},
    "groupBy": "day",
    "limit": 7
  }}
  
  Example 8: "How many people are not available tomorrow?"
  {{
    "queryType": "count",
    "category": "all",
    "timeFrame": {{"start": "2025-03-25T00:00:00Z", "end": "2025-03-25T23:59:59Z"}},
    "filters": {{
      "start_date": {{"lte": "2025-03-25T23:59:59Z"}},
      "end_date": {{"gte": "2025-03-25T00:00:00Z"}}
    }},
    "groupBy": "user"
  }}
  
  Example 9: "List everyone who was on half-day leave in the first quarter"
  {{
    "queryType": "list",
    "category": "half_leave",
    "timeFrame": "quarter",
    "filters": {{
      "start_date": {{"gte": "2025-01-01T00:00:00Z", "lte": "2025-03-31T23:59:59Z"}}
    }},
    "groupBy": "user",
    "limit": 100
  }}
  
  Example 10: "Give me a trend of WFH requests this year by month"
  {{
    "queryType": "trend",
    "category": "wfh",
    "timeFrame": "year",
    "filters": {{
      "is_working_from_home": true,
      "start_date": {{"gte": "2025-01-01T00:00:00Z", "lte": "2025-12-31T23:59:59Z"}}
    }},
    "groupBy": "day"
  }}
  
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
  try {
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
  } catch (error) {
    console.log("Details error", error);
  }
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
