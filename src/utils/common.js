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

function mapAttendanceCategory(category) {
  const categoryMap = {
    WFH: "wfh",
    "WORK FROM HOME": "wfh",
    "FULL DAY LEAVE": "full_leave",
    "HALF DAY LEAVE": "half_leave",
    "LATE TO OFFICE": "come_late",
    "LEAVING EARLY": "leave_early",
  };

  return categoryMap[category.toUpperCase()] || "unknown";
}

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
    if (params.filters?.start_date || params.filters?.end_date) {
      if (params.filters.start_date?.lte) {
        query = query.lte("start_date", params.filters.start_date.lte);
      }
      if (params.filters.end_date?.gte) {
        query = query.gte("end_date", params.filters.end_date.gte);
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

module.exports = {
  executeQuery,
  storeAttendanceData,
  formatCountResponse,
  formatListResponse,
  formatTrendResponse,
  formatSummaryResponse,
  formatTimeFrameText,
  mapAttendanceCategory,
  formatTimeFrameText,
  formatCountResponse,
  formatListResponse,
  formatTrendResponse,
  formatSummaryResponse,
  formatTimeFrameText,
  mapAttendanceCategory,
};
