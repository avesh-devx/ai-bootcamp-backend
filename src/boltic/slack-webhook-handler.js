const axios = require("axios");

/**
 * Slack Webhook Handler for Boltic Workflows
 * Processes Slack messages and coordinates with other services
 */

// Extract user info from Slack event
function extractUserInfo(event) {
  return {
    userId: event.user,
    message: event.text,
    channel: event.channel,
    timestamp: event.ts,
    isEdit: event.subtype === "message_changed",
  };
}

// Get user details from Slack API
async function getUserDetails(userId, slackToken) {
  try {
    const response = await axios.get(`https://slack.com/api/users.info`, {
      headers: {
        Authorization: `Bearer ${slackToken}`,
        "Content-Type": "application/json",
      },
      params: {
        user: userId,
      },
    });

    if (response.data.ok) {
      const user = response.data.user;
      return {
        userName: user.real_name || user.name,
        firstName: user.profile?.first_name || "",
        lastName: user.profile?.last_name || "",
        email: user.profile?.email || "",
      };
    }

    throw new Error("Failed to get user info from Slack");
  } catch (error) {
    console.error("Error getting user details:", error);
    return {
      userName: "Unknown User",
      firstName: "",
      lastName: "",
      email: "",
    };
  }
}

// Main webhook handler
async function handleSlackWebhook(requestData) {
  try {
    const { event, slackToken } = requestData;

    // Skip bot messages and non-message events
    if (event.bot_id || !event.text) {
      return {
        success: true,
        message: "Skipped bot message or empty text",
        action: "skipped",
      };
    }

    // Extract basic info
    const userInfo = extractUserInfo(event);

    // Get detailed user info from Slack
    const userDetails = await getUserDetails(userInfo.userId, slackToken);

    // Prepare response data for Boltic workflow
    const processedData = {
      ...userInfo,
      ...userDetails,
      processedAt: new Date().toISOString(),
    };

    return {
      success: true,
      data: processedData,
      message: "Slack message processed successfully",
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// Process complete attendance workflow
async function processAttendanceWorkflow(requestData) {
  try {
    const { message, userId, userName, firstName, lastName, email } =
      requestData;

    // This would be called by Boltic after getting classification and details
    // from the other services

    const result = {
      userId,
      userName,
      firstName,
      lastName,
      email,
      message,
      processedAt: new Date().toISOString(),
      status: "ready_for_storage",
    };

    return {
      success: true,
      data: result,
      message: "Attendance workflow data prepared",
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// Send response back to Slack
async function sendSlackResponse(requestData) {
  try {
    const {
      channelId,
      message,
      slackToken,
      responseType = "ephemeral", // or 'in_channel'
    } = requestData;

    const response = await axios.post(
      "https://slack.com/api/chat.postMessage",
      {
        channel: channelId,
        text: message,
        response_type: responseType,
      },
      {
        headers: {
          Authorization: `Bearer ${slackToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.ok) {
      return {
        success: true,
        message: "Response sent to Slack successfully",
      };
    }

    throw new Error("Failed to send message to Slack");
  } catch (error) {
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  handleSlackWebhook,
  processAttendanceWorkflow,
  sendSlackResponse,
  extractUserInfo,
  getUserDetails,
};
