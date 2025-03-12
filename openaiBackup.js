const sql = require("./src/config/db");
const express = require("express");
const app = express();
const { App } = require("@slack/bolt");
const dotenv = require("dotenv");
const { default: OpenAI } = require("openai");
const logger = require("./src/libs/loggerConfig");
const supabase = require("./src/libs/supabaseClient");

dotenv.config();

app.use(express.json());

console.log("keyyyyyyyy", process.env.OPENAI_API_KEY);

// Initialize Slack app
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN, // Bot User OAuth Token
  signingSecret: process.env.SLACK_SIGNING_SECRET, // Signing Secret
  socketMode: true, // Enable Socket Mode
  appToken: process.env.SLACK_APP_TOKEN, // App-Level Token
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ message.channels → For messages in public channels.
// ✅ message.groups → For messages in private channels (needed if you're using private channels).
// ✅ message.im → For messages in DMs with the bot (if needed).
// ✅ message.mpim → For group DMs (optional).

// Attach Slack Bolt's built-in router to Express
// console.log("loggggggg", slackApp.receiver.router);
// app.use("/slack/events", slackApp.receiver.router);

// Listen for messages in channels the bot is added to
slackApp.event("message", async ({ event, client }) => {
  try {
    // Only process messages from actual users (not bots)
    if (event.subtype === undefined && event.bot_id === undefined) {
      logger.info(`Received message: ${event.text}`);

      // Get user info
      const userInfo = await client.users.info({
        user: event.user,
      });

      // Extract user details
      const userName = userInfo.user.real_name;
      const firstName = userInfo.user.profile.first_name || "";
      const lastName = userInfo.user.profile.last_name || "";
      const email = userInfo.user.profile.email || "";

      // console.log("uuuuuuuu", userInfo);
      // console.log("evvvvvvv", event.text);

      // Classify message
      const { category, confidence } = await classifyMessage(event.text);

      // Parse additional details from the message
      const { isWorkingFromHome, isLeaveRequest, isRunningLate, reason } =
        parseMessageDetails(event);

      // Log the structured data
      const logData = {
        user_name: userName,
        timestamp: new Date(parseInt(event.ts) * 1000).toISOString(),
        email: email,
        user_id: event.user,
        category: category,
        reason: reason || "N/A",
        is_working_from_home: isWorkingFromHome,
        is_leave_requested: isLeaveRequest,
        is_running_late: isRunningLate,
      };

      // Log to console and file
      console.log("Attendance record:", JSON.stringify(logData));
      logger.info("Attendance record", logData);

      // Store in database
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
        isWorkingFromHome,
        isLeaveRequest,
        isRunningLate,
        reason,
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
    logger.info(`Received query: ${command.text}`);
    const result = await processQuery(command.text);
    await respond(result);
  } catch (error) {
    logger.error(`Error processing query: ${error}`);
    await respond("Sorry, I couldn't process that query. Please try again.");
  }
});

// Function to classify message using OpenAI
async function classifyMessage(message) {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",

        // content:
        // "You are a helpful assistant that categorizes attendance messages. " +
        // "Categorize the following message into exactly one of these categories: " +
        // "WFH, FULL DAY LEAVE, HALF DAY LEAVE, LATE TO OFFICE, LEAVING EARLY. " +
        // "Respond with only the category name.",

        // content:
        //   "You are a helpful assistant that categorizes attendance messages. " +
        //   "Categorize the following message into exactly one of these categories: " +
        //   "WFH, FULL DAY LEAVE, HALF DAY LEAVE, LATE TO OFFICE, LEAVING EARLY. " +
        //   "Respond with only the category name.",

        content: `You are a helpful assistant that translates natural language queries about attendance data into JSON format for database queries.
                  The database has a table called 'leave_table' with columns: id, user_id, user_name, timestamp, message, category, is_working_from_home, is_leave_requested, is_running_late, first_name, last_name, is_coming_late, is_leave_early, email.
                  Valid categories are: wfh, full_leave, half_leave, leave_early, come_late.
                  Format your response as a JSON object with these properties:
                  - queryType: 'count', 'list', 'trend', or 'summary'
                  - category: the attendance category to filter by (if applicable)
                  - timeFrame: 'day', 'week', 'month', 'quarter', or custom date range as {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}
                  - groupBy: 'user', 'day', 'category' (if applicable)
                  - limit: number of results to return (if applicable)
                  - filters: additional filters for boolean fields like is_working_from_home, is_leave_requested, is_running_late (if applicable)
                  Respond with valid JSON only.`,
      },
      {
        role: "user",
        content: message,
      },
    ],
    temperature: 0.3,
    max_tokens: 10,
  });

  const category = response.choices[0].message.content.trim();
  const confidence = 0.9; // Note: GPT doesn't provide confidence scores directly

  return { category, confidence };
}

// Function to parse additional details from the message
function parseMessageDetails(event) {
  const message = event.text.toLowerCase();

  // Initialize return values
  let isWorkingFromHome = false;
  let isLeaveRequest = false;
  let isRunningLate = false;
  let reason = null;

  // Check for WFH indicators
  if (
    message.includes("wfh") ||
    message.includes("working from home") ||
    message.includes("work from home")
  ) {
    isWorkingFromHome = true;
  }

  // Check for leave indicators
  if (
    message.includes("leave") ||
    message.includes("off") ||
    message.includes("vacation") ||
    message.includes("holiday")
  ) {
    isLeaveRequest = true;
  }

  // Check for late indicators
  if (
    message.includes("late") ||
    message.includes("delay") ||
    message.includes("running behind") ||
    message.includes("coming late")
  ) {
    isRunningLate = true;
  }

  // Extract reason - look for common patterns
  // After "reason:", "because", "due to", etc.
  let reasonMatch =
    message.match(/reason\s*:?\s*(.+)/i) ||
    message.match(/because\s*:?\s*(.+)/i) ||
    message.match(/due to\s*:?\s*(.+)/i);

  if (reasonMatch) {
    reason = reasonMatch[1].trim();
  }

  return {
    isWorkingFromHome,
    isLeaveRequest,
    isRunningLate,
    reason,
  };
}

// Function to store attendance data in Supabase
async function storeAttendanceData(data) {
  console.log("dataaaaa", data);
  // Map the category from OpenAI response to your enum values
  let mappedCategory;
  switch (data.category.toUpperCase()) {
    case "WFH":
      mappedCategory = "wfh";
      break;
    case "FULL DAY LEAVE":
    case "FULL LEAVE":
      mappedCategory = "full_leave";
      break;
    case "HALF DAY LEAVE":
    case "HALF LEAVE":
      mappedCategory = "half_leave";
      break;
    case "LEAVING EARLY":
    case "LEAVE EARLY":
      mappedCategory = "leave_early";
      break;
    case "LATE TO OFFICE":
    case "COME LATE":
      mappedCategory = "come_late";
      break;
    default:
      mappedCategory = null;
  }

  // Prepare user data based on what we have
  const userData = {
    user_id: data.userId,
    user_name: data.userName,
    timestamp: new Date(parseInt(data.timestamp) * 1000).toISOString(),
    message: data.message,
    category: mappedCategory,
    is_working_from_home: data.isWorkingFromHome,
    is_leave_requested: data.isLeaveRequest,
    is_running_late: data.isRunningLate,
  };

  // Add first_name, last_name if available
  if (data.firstName) userData.first_name = data.firstName;
  if (data.lastName) userData.last_name = data.lastName;
  if (data.email) userData.email = data.email;

  console.log("Inserting data into Supabase:", userData);

  const response = await supabase.from("leave-table").insert([userData]);

  console.log("ressssssssss", response);

  // if (error) {
  //   console.error("Database error:", error);
  //   throw error;
  // }

  console.log("Data successfully stored in database");
}

// Function to process natural language queries
async function processQuery(query) {
  // Use OpenAI to parse the query
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant that categorizes attendance messages. " +
          "Categorize the following message into exactly one of these categories: " +
          "wfh, full_leave, half_leave, leave_early, come_late. " +
          "Respond with only the category name, exactly as shown above.",
      },
      {
        role: "user",
        content: message,
      },
    ],
    temperature: 0.3,
    max_tokens: 10,
  });

  try {
    const queryParams = JSON.parse(response.choices[0].message.content);
    return await executeQuery(queryParams);
  } catch (error) {
    logger.error("Error parsing query:", error);
    return "I couldn't understand that query. Please try again with a different wording.";
  }
}

// Function to execute database queries based on parsed parameters
async function executeQuery(params) {
  let query = supabase.from("leave-table").select("*");

  // Add filters based on queryParams
  if (params.category) {
    query = query.eq("category", params.category);
  }

  // Handle time frame
  if (params.timeFrame) {
    const { start, end } = calculateTimeRange(params.timeFrame);
    query = query.gte("timestamp", start).lte("timestamp", end);
  }

  // Execute query
  const { data, error } = await query;

  if (error) throw error;

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

// Helper functions to format responses
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
  if (data.length === 0) return "No matching records found.";

  const category = params.category || "attendance records";
  const timeFrame = formatTimeFrameText(params.timeFrame);

  // Group by date
  const dailyCounts = {};
  data.forEach((record) => {
    const date = new Date(record.timestamp).toLocaleDateString();
    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
  });

  let response = `*${category.toUpperCase()} Trend for ${timeFrame}*\n\n`;

  Object.entries(dailyCounts)
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .forEach(([date, count]) => {
      const bars = "█".repeat(Math.min(Math.ceil(count / 2), 10));
      response += `${date}: ${bars} (${count})\n`;
    });

  return response;
}

function formatSummaryResponse(data, params) {
  if (data.length === 0) return "No matching records found.";

  const timeFrame = formatTimeFrameText(params.timeFrame);

  // Group by category
  const categoryCounts = {};
  data.forEach((record) => {
    categoryCounts[record.category] =
      (categoryCounts[record.category] || 0) + 1;
  });

  // Count unique users
  const uniqueUsers = new Set(data.map((record) => record.user_id)).size;

  let response = `*Attendance Summary for ${timeFrame}*\n\n`;
  response += `Total Records: ${data.length}\n`;
  response += `Unique Users: ${uniqueUsers}\n\n`;
  response += `*Breakdown by Category:*\n`;

  Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, count]) => {
      const percentage = Math.round((count / data.length) * 100);
      response += `${category}: ${count} (${percentage}%)\n`;
    });

  return response;
}

function formatTimeFrameText(timeFrame) {
  if (typeof timeFrame === "object" && timeFrame.start && timeFrame.end) {
    return `${new Date(timeFrame.start).toLocaleDateString()} to ${new Date(
      timeFrame.end
    ).toLocaleDateString()}`;
  }

  switch (timeFrame) {
    case "day":
      return "Today";
    case "week":
      return "Past Week";
    case "month":
      return "Past Month";
    case "quarter":
      return "Past Quarter";
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
