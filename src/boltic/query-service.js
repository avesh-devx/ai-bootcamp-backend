const axios = require("axios");
const { format } = require("date-fns");

/**
 * Query Service for Boltic Workflows
 * Converts natural language queries about attendance into structured database query parameters
 */

// Boltic workflow URL for AI query processing
const BOLTIC_QUERY_WORKFLOW_URL =
  process.env.BOLTIC_CLASSIFICATION_WORKFLOW_URL ||
  "https://asia-south1.workflow.boltic.app/d6ed0331-7110-4c63-9251-c34e90ae8098";

// Query prompt for AI - converts natural language to database query structure
const QUERY_PROMPT = `You are a world-class SQL database expert specializing in converting natural language queries about attendance and leave management into precise Supabase query JSON. Your responses will be used in production by an enterprise application with millions of users, so accuracy is absolutely critical.

Role and Context

You are the query engine for an enterprise-grade attendance management system. Your job is to interpret user queries about employee attendance, leave, work-from-home, and related statuses, then translate these into structured JSON that will be used to query the Supabase database. You must be meticulous about date/time handling, timezone conversion, and properly mapping concepts to the database schema.

Critical Date Handling Rules

Current Reference Points (ALWAYS USE THESE AS ANCHORS):
- Today's date: ${format(new Date(), "yyyy-MM-dd")}
- Current month: ${format(new Date(), "MMMM yyyy")}
- Current year: ${new Date().getFullYear()}
- Current time: ${format(new Date(), "HH:mm:ss")}

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
{
  "queryType": "list",
  "category": "all",
  "timeFrame": {"start": "2025-03-29T00:00:00Z", "end": "2025-03-29T23:59:59Z"},
  "filters": {
    "start_date": {"lte": "2025-03-29T23:59:59Z"},
    "end_date": {"gte": "2025-03-29T00:00:00Z"}
  },
  "groupBy": "user",
  "limit": 50
}

Example 2: "Show me who's working from home this week"
{
  "queryType": "list",
  "category": "wfh",
  "timeFrame": "week",
  "filters": {
    "is_working_from_home": true,
    "start_date": {"lte": "2025-03-30T23:59:59Z"},
    "end_date": {"gte": "2025-03-24T00:00:00Z"}
  },
  "groupBy": "user",
  "limit": 50
}

Example 3: "Count how many people were late last month"
{
  "queryType": "count",
  "category": "come_late",
  "timeFrame": "month",
  "filters": {
    "is_coming_late": true,
    "start_date": {"gte": "2025-02-01T00:00:00Z", "lte": "2025-02-28T23:59:59Z"}
  },
  "groupBy": "user"
}

Example 4: "Give me the list of people who were doing work from home last month"
{
  "queryType": "list",
  "category": "wfh",
  "timeFrame": {"start": "2025-02-01T00:00:00Z", "end": "2025-02-28T23:59:59Z"},
  "filters": {
    "is_working_from_home": true,
    "start_date": {"lte": "2025-02-28T23:59:59Z"},
    "end_date": {"gte": "2025-02-01T00:00:00Z"}
  },
  "groupBy": "user",
  "limit": 50
}

Example 5: "Show me the summary report of this month"
{
  "queryType": "summary",
  "category": "all",
  "timeFrame": "month",
  "filters": {
    "start_date": {"lte": "2025-03-31T23:59:59Z"},
    "end_date": {"gte": "2025-03-01T00:00:00Z"}
  },
  "groupBy": "category"
}

Query: {USER_QUERY}

Generate JSON response with EXACTLY this structure (ONLY JSON, NO TEXT BEFORE/AFTER):
{
  "queryType": "count|list|trend|summary",
  "category": "all|wfh|full_leave|half_leave|leave_early|come_late",
  "timeFrame": "day|week|month|quarter|{\"start\":\"ISO_DATE\",\"end\":\"ISO_DATE\"}",
  "groupBy": "user|day|category",
  "limit": 10,
  "filters": {
    "start_date": {"gte?": "ISO_DATE", "lte?": "ISO_DATE"},
    "end_date": {"gte?": "ISO_DATE", "lte?": "ISO_DATE"},
    "user_id?": "value",
    "user_name?": "value"
  }
}

ONLY respond with valid JSON. No code blocks, no explanations, no markdown formatting.
`;

// Call Boltic AI workflow for query processing
async function processQueryWithAI(query) {
  try {
    const prompt = QUERY_PROMPT.replace("{USER_QUERY}", query);

    const payload = {
      prompt: prompt,
      message: query,
    };

    const headers = {
      "Content-Type": "application/json",
    };

    const response = await axios.post(BOLTIC_QUERY_WORKFLOW_URL, payload, {
      headers,
    });

    if (response.data) {
      // Try to parse AI response
      let aiResult;

      // Handle Boltic workflow response structure
      if (
        response.data.response_body &&
        response.data.response_body.choices &&
        response.data.response_body.choices[0]
      ) {
        // Extract the text from Boltic response structure
        const aiText = response.data.response_body.choices[0].text;

        // Remove markdown code blocks if present
        const cleanText = aiText.replace(/```json\n?|\n?```/g, "").trim();

        try {
          aiResult = JSON.parse(cleanText);
        } catch (parseError) {
          console.error("Failed to parse AI JSON response:", parseError);
          // Try to extract JSON from the text
          const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            aiResult = JSON.parse(jsonMatch[0]);
          } else {
            // Fallback parsing for plain text response
            aiResult = parseTextResponse(aiText, query);
          }
        }
      } else if (typeof response.data === "string") {
        // If response is string, try to extract JSON
        const jsonMatch = response.data.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback parsing for plain text response
          aiResult = parseTextResponse(response.data, query);
        }
      } else {
        aiResult = response.data;
      }

      // Validate and ensure required fields
      return validateQueryResult(aiResult);
    }

    throw new Error("No response from Boltic workflow");
  } catch (error) {
    console.error("Boltic workflow error:", error.message);

    // Fallback to simple query processing if AI fails
    return fallbackQueryProcessing(query);
  }
}

// Validate and ensure required fields in query result
function validateQueryResult(result) {
  return {
    queryType: result.queryType || "list",
    category: result.category || "all",
    timeFrame: result.timeFrame || "day",
    groupBy: result.groupBy || "user", // Ensure groupBy is never null
    limit: result.limit || 10,
    filters: result.filters || {},
  };
}

// Fallback query processing if AI workflow fails
function fallbackQueryProcessing(query) {
  const q = query.toLowerCase();

  // Determine query type
  let queryType = "list";
  if (q.includes("count") || q.includes("how many")) {
    queryType = "count";
  } else if (q.includes("trend") || q.includes("over time")) {
    queryType = "trend";
  } else if (q.includes("summary") || q.includes("report")) {
    queryType = "summary";
  }

  // Determine category
  let category = "all";
  if (q.includes("wfh") || q.includes("work from home")) {
    category = "wfh";
  } else if (q.includes("half day")) {
    category = "half_leave";
  } else if (q.includes("leave") || q.includes("off")) {
    category = "full_leave";
  } else if (q.includes("late")) {
    category = "come_late";
  } else if (q.includes("early")) {
    category = "leave_early";
  }

  // Determine time frame
  let timeFrame = "day";
  if (q.includes("week")) {
    timeFrame = "week";
  } else if (q.includes("month")) {
    timeFrame = "month";
  } else if (q.includes("quarter")) {
    timeFrame = "quarter";
  }

  // Basic filters
  const filters = {};
  if (category === "wfh") {
    filters.is_working_from_home = true;
  } else if (category === "full_leave") {
    filters.is_leave_requested = true;
  } else if (category === "come_late") {
    filters.is_coming_late = true;
  } else if (category === "leave_early") {
    filters.is_leaving_early = true;
  }

  return {
    queryType,
    category,
    timeFrame,
    groupBy: "user",
    limit: 10,
    filters,
  };
}

// Parse text response from AI if JSON parsing fails
function parseTextResponse(textResponse, query) {
  const text = textResponse.toLowerCase();
  const originalQuery = query.toLowerCase();

  // Try to extract query type
  let queryType = "list";
  if (
    text.includes("count") ||
    originalQuery.includes("count") ||
    originalQuery.includes("how many")
  ) {
    queryType = "count";
  } else if (text.includes("summary") || originalQuery.includes("summary")) {
    queryType = "summary";
  } else if (text.includes("trend") || originalQuery.includes("trend")) {
    queryType = "trend";
  }

  // Try to extract category
  let category = "all";
  if (
    text.includes("wfh") ||
    originalQuery.includes("wfh") ||
    originalQuery.includes("work from home")
  ) {
    category = "wfh";
  } else if (text.includes("leave") || originalQuery.includes("leave")) {
    category = "full_leave";
  }

  // Default timeFrame
  let timeFrame = "day";
  if (text.includes("week") || originalQuery.includes("week")) {
    timeFrame = "week";
  } else if (text.includes("month") || originalQuery.includes("month")) {
    timeFrame = "month";
  }

  return {
    queryType,
    category,
    timeFrame,
    groupBy: "user",
    limit: 10,
    filters: {},
  };
}

// API endpoint for Boltic to call
async function handleQueryRequest(query) {
  try {
    if (!query) {
      throw new Error("Query is required");
    }
    const result = await processQueryWithAI(query);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Query processing error:", error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  handleQueryRequest,
};
