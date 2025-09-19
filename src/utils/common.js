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

module.exports.formatResponse = function formatResponse(data) {
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
};

module.exports.mapAttendanceCategory = function mapAttendanceCategory(
  category
) {
  const categoryMap = {
    WFH: "wfh",
    "WORK FROM HOME": "wfh",
    "FULL DAY LEAVE": "full_leave",
    "HALF DAY LEAVE": "half_leave",
    "LATE TO OFFICE": "come_late",
    "LEAVING EARLY": "leave_early",
  };

  return categoryMap[category.toUpperCase()] || "unknown";
};

module.exports.calculateTimeRange = function calculateTimeRange(timeFrame) {
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
};

module.exports.formatCountResponse = function formatCountResponse(
  counts,
  params
) {
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
};

module.exports.formatListResponse = function formatListResponse(data, params) {
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
};

module.exports.formatTrendResponse = function formatTrendResponse(
  data,
  params
) {
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
};

module.exports.formatSummaryResponse = function formatSummaryResponse(
  data,
  params
) {
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
};

module.exports.formatTimeFrameText = function formatTimeFrameText(timeFrame) {
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
};
