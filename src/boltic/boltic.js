const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { App } = require("@slack/bolt");

// Import all Boltic services
const { handleClassificationRequest } = require("./classification-service");
const {
  handleDetailsExtractionRequest,
} = require("./details-extraction-service");

const logger = require("../libs/loggerConfig");
const supabase = require("../libs/supabaseClient");
const { mapAttendanceCategory, formatResponse } = require("../utils/common");
const { handleQueryRequest } = require("./query-service");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// ---------------------------Slack app---------------------------

const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN, // Bot User OAuth Token
  signingSecret: process.env.SLACK_SIGNING_SECRET, // Signing Secret
  socketMode: true, // Enable Socket Mode
  appToken: process.env.SLACK_APP_TOKEN, // App-Level Token
});

// ---------------------------Slack event listeners---------------------------
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
        original_ts: event.previous_message?.ts,
        is_edit: true,
      };
      await processAttendanceMessage(editedEvent, client);
    }
  } catch (error) {
    logger.error(`Error processing message: ${error}`);
  }
});

// Function to process attendance messages (new or edited)
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
    const { data: classificationResult } = await handleClassificationRequest(
      event.text
    );
    const { data: detailsResult } = await handleDetailsExtractionRequest(
      event.text
    );

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
      category: classificationResult.category,
      confidence: classificationResult.confidence,
      channelId: event.channel,
      detailsResult: detailsResult,
    });
  } catch (error) {
    logger.error("Details error", error);
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
        logger.info("Updated existing record based on message edit");
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

        // If there are multiple overlapping records, we might want to delete them
        if (overlappingRecords.length > 1) {
          const idsToDelete = overlappingRecords.slice(1).map((r) => r.id);
          const { error: deleteError } = await supabase
            .from("leave-table")
            .delete()
            .in("id", idsToDelete);

          if (deleteError) {
            logger.error("Error deleting redundant records:", deleteError);
          } else {
            logger.info(
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
      logger.error("Database error:", error);
      throw error;
    }
  } catch (error) {
    logger.error("Error handling attendance record:", error);
    throw error;
  }
}

// Slack slash command for queries (Querying slack bot for attendance records)
slackApp.command("/leave-table", async ({ command, ack, respond }) => {
  await ack();

  try {
    // Get query parameters from Boltic AI service
    const queryResponse = await handleQueryRequest(command.text);

    if (!queryResponse.success) {
      throw new Error(queryResponse.error);
    }

    const queryResult = queryResponse.data;

    // Build Supabase query based on AI response
    let query = supabase.from("leave-table").select("*");

    // Apply category filters
    if (queryResult.category && queryResult.category !== "all") {
      query = query.eq("category", queryResult.category);
    }

    // Apply boolean filters based on category
    if (queryResult.filters) {
      Object.entries(queryResult.filters).forEach(([key, value]) => {
        if (typeof value === "boolean") {
          query = query.eq(key, value);
        } else if (typeof value === "string" && key === "user_name") {
          query = query.ilike(key, `%${value}%`);
        } else if (typeof value === "object" && value !== null) {
          // Handle date range filters
          if (value.gte) query = query.gte(key, value.gte);
          if (value.lte) query = query.lte(key, value.lte);
          if (value.eq) query = query.eq(key, value.eq);
        }
      });
    }

    // Apply date range filtering for overlapping records
    if (queryResult.timeFrame && typeof queryResult.timeFrame === "object") {
      const { start, end } = queryResult.timeFrame;
      if (start && end) {
        // Find records that overlap with the query time range
        query = query
          .lte("start_date", end) // Record starts before or on query end
          .gte("end_date", start); // Record ends after or on query start
      }
    }

    // Apply limit
    if (queryResult.limit) {
      query = query.limit(queryResult.limit);
    }

    // Order by timestamp for consistent results
    query = query.order("timestamp", { ascending: false });

    // Execute query
    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Format and send response
    if (data && data.length > 0) {
      let responseText;

      switch (queryResult.queryType) {
        case "count":
          responseText = `Found ${data.length} matching records.`;
          break;
        case "summary":
          // Group by category or user for summary
          const summary = {};
          data.forEach((record) => {
            const key =
              queryResult.groupBy === "category"
                ? record.category
                : record.user_name;
            summary[key] = (summary[key] || 0) + 1;
          });
          responseText = `*Summary Report:*\n${Object.entries(summary)
            .map(([key, count]) => `• ${key}: ${count} records`)
            .join("\n")}`;
          break;
        default:
          responseText = formatResponse(data);
      }

      await respond(responseText);
    } else {
      await respond("No matching records found for your query.");
    }
  } catch (error) {
    logger.error("Query execution error:", error);
    await respond(`⚠️ Error processing query: ${error.message.split("\n")[0]}`);
  }
});

//----------------------------Connection-----------------------------
//app.listen
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
  logger.info("Slack Bolt app is running");

  const dbConnected = await testDatabaseConnection();
  if (dbConnected) {
    logger.info("Database connection verified successfully");
  } else {
    logger.warn("WARNING: Database connection issue detected");
  }
})();

app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    timestamp: new Date().toISOString(),
  });
});

module.exports = app;
