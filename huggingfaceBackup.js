// Function to classify message using Hugging Face API
// async function classifyMessage(message) {
//   try {
//     // Use a more instruction-tuned model
//     const response = await hf.textGeneration({
//       model: "mistralai/Mistral-7B-Instruct-v0.2", // Better instruction-following model
//       inputs: `<s>[INST] You are a helpful assistant that categorizes attendance messages.
// Categorize the following message into exactly one of these categories:
// 1. WFH (Work From Home)
// 2. FULL DAY LEAVE
// 3. HALF DAY LEAVE
// 4. LATE TO OFFICE
// 5. LEAVING EARLY
// Respond with ONLY the category name in uppercase, nothing else.

// Message: ${message} [/INST]</s>`,
//       parameters: {
//         max_new_tokens: 20, // Enough for the category name
//         temperature: 0.1, // Lower temperature for more deterministic outputs
//         do_sample: false, // Don't use sampling for classification
//         return_full_text: false, // Don't include the prompt in the output
//       },
//     });

//     // Clean the response to extract just the category
//     let category = response.generated_text.trim();

//     // Extract just the category if it contains other text
//     const categoryPatterns = [
//       /WFH|WORK FROM HOME/i,
//       /FULL DAY LEAVE/i,
//       /HALF DAY LEAVE/i,
//       /LATE TO OFFICE/i,
//       /LEAVING EARLY/i,
//     ];

//     for (const pattern of categoryPatterns) {
//       const match = category.match(pattern);
//       if (match) {
//         category = match[0].toUpperCase();
//         break;
//       }
//     }

//     console.log("Classified category:", category);
//     const confidence = 0.9; // Placeholder since HF doesn't provide confidence scores

//     return { category, confidence };
//   } catch (error) {
//     console.error(`Error classifying message with Hugging Face: ${error}`);
//     throw error;
//   }
// }

// Function to parse additional details from the message
// function parseMessageDetails(event) {
//   const message = event.text.toLowerCase();

//   // Initialize return values
//   let isWorkingFromHome = false;
//   let isLeaveRequest = false;
//   let isRunningLate = false;
//   let reason = null;

//   // Check for WFH indicators
//   if (
//     message.includes("wfh") ||
//     message.includes("working from home") ||
//     message.includes("work from home")
//   ) {
//     isWorkingFromHome = true;
//   }

//   // Check for leave indicators
//   if (
//     message.includes("leave") ||
//     message.includes("off") ||
//     message.includes("vacation") ||
//     message.includes("holiday")
//   ) {
//     isLeaveRequest = true;
//   }

//   // Check for late indicators
//   if (
//     message.includes("late") ||
//     message.includes("delay") ||
//     message.includes("running behind") ||
//     message.includes("coming late")
//   ) {
//     isRunningLate = true;
//   }

//   // Extract reason - look for common patterns
//   // After "reason:", "because", "due to", etc.
//   let reasonMatch =
//     message.match(/reason\s*:?\s*(.+)/i) ||
//     message.match(/because\s*:?\s*(.+)/i) ||
//     message.match(/due to\s*:?\s*(.+)/i);

//   if (reasonMatch) {
//     reason = reasonMatch[1].trim();
//   }

//   return {
//     isWorkingFromHome,
//     isLeaveRequest,
//     isRunningLate,
//     reason,
//   };
// }

// function getMappedCategory(category) {
//   const lowerCategory = category.toLowerCase(); // error is here this should be give the proper category classified category

//   console.log("mappppppppppppp", lowerCategory);

//   // Define a mapping of keywords to categories
//   const categoryMapping = {
//     wfh: [/wfh/, /work from home/, /working from home/],
//     full_leave: [
//       /full day leave/,
//       /full leave/,
//       /on leave/,
//       /leave today/,
//       /leave tomorrow/,
//       /taking leave/,
//       /on vacation/,
//       /on holiday/,
//     ],
//     half_leave: [
//       /half day leave/,
//       /half leave/,
//       /first half/,
//       /second half/,
//       /half day/,
//       /half-day/,
//     ],
//     come_late: [
//       /late to office/,
//       /come late/,
//       /running late/,
//       /will be late/,
//       /arriving late/,
//     ],
//     leave_early: [
//       /leaving early/,
//       /leave early/,
//       /will leave early/,
//       /going home early/,
//     ],
//   };

//   // Iterate through the mapping to find a match
//   for (const [key, regexes] of Object.entries(categoryMapping)) {
//     if (regexes.some((regex) => regex.test(lowerCategory))) {
//       return key; // Return the matched category
//     }
//   }

//   // If no match is found, log an error and default to "wfh"

//   logger.error(`Unknown categoryyyyyyyyy: ${category}`);
//   return "wfh"; // Default to WFH
// }

// Function to store attendance data in Supabase
// async function storeAttendanceData(data) {
//   try {
//     // Map the category using the refactored logic
//     const mappedCategory = getMappedCategory(data.category);

//     // Prepare user data based on what we have
//     const userData = {
//       user_id: data.userId,
//       user_name: data.userName,
//       timestamp: new Date(parseInt(data.timestamp) * 1000).toISOString(),
//       message: data.message,
//       category: mappedCategory,
//       is_working_from_home: mappedCategory === "wfh", // Derived from category
//       is_leave_requested:
//         mappedCategory === "full_leave" || mappedCategory === "half_leave", // Derived from category
//       is_coming_late: mappedCategory === "come_late", // Derived from category
//       is_leave_early: mappedCategory === "leave_early", // Derived from category
//       first_name: data.firstName || null, // Ensure null if not provided
//       last_name: data.lastName || null, // Ensure null if not provided
//       email: data.email || null, // Ensure null if not provided
//     };

//     console.log("Inserting data into Supabase:", userData);

//     const { error } = await supabase.from("leave-table").insert([userData]);

//     if (error) {
//       console.error("Database error:", error);
//       throw error;
//     }

//     const timestampDate = new Date(parseInt(data.timestamp) * 1000);
//     const formattedDate = format(timestampDate, "dd-MMM-yyyy");

//     // Create detailed log entry
//     const logEntry = `${formattedDate} - ${userData.user_name} - ${userData.user_id} - ${mappedCategory} - "${userData.message}" - ${userData.is_working_from_home} - ${userData.is_leave_requested} - ${userData.is_coming_late} - ${userData.is_leave_early}`;

//     // Log the detailed information
//     logger.info(`Attendance record: ${logEntry}`);

//     console.log("Data successfully stored in database");
//   } catch (error) {
//     console.error("Error storing data:", error);
//     throw error;
//   }
// }

// Function to process natural language queries using Hugging Face API
// async function processQuery(query) {
//   try {
//     const response = await hf.textGeneration({
//       model: "mistralai/Mistral-7B-Instruct-v0.2", // Better instruction-following model
//       inputs: `<s>[INST] You are a helpful assistant that translates natural language queries about attendance data into JSON format for database queries.

// The database has a table called 'leave_table' with columns: id, user_id, user_name, timestamp, message, category, is_working_from_home, is_leave_requested, is_running_late, first_name, last_name, email.

// Valid categories are: wfh, full_leave, half_leave, leave_early, come_late.

// Format your response as a JSON object with these properties:
// - queryType: 'count', 'list', 'trend', or 'summary'
// - category: the attendance category to filter by (if applicable)
// - timeFrame: 'day', 'week', 'month', 'quarter', or custom date range as {start: 'YYYY-MM-DD', end: 'YYYY-MM-DD'}
// - groupBy: 'user', 'day', 'category' (if applicable)
// - limit: number of results to return (if applicable)
// - filters: additional filters for boolean fields like is_working_from_home, is_leave_requested, is_running_late (if applicable)

// Respond with ONLY valid JSON, no explanations or additional text.

// Query: ${query} [/INST]</s>`,
//       parameters: {
//         max_new_tokens: 500, // Increased to handle complex JSON responses
//         temperature: 0.1, // Lower temperature for more deterministic outputs
//         do_sample: false, // Don't use sampling for structured outputs
//         return_full_text: false, // Don't include the prompt in the output
//       },
//     });

//     // Clean the response to extract just the JSON
//     let jsonText = response.generated_text.trim();

//     // Look for the first { and last } to extract just the JSON part if there's any extra text
//     const startIdx = jsonText.indexOf("{");
//     const endIdx = jsonText.lastIndexOf("}");

//     if (startIdx >= 0 && endIdx >= 0) {
//       jsonText = jsonText.substring(startIdx, endIdx + 1);
//     }

//     // Parse the JSON
//     const queryParams = JSON.parse(jsonText);

//     // Log the structured query parameters
//     logger.info(
//       `Processed query into parameters: ${JSON.stringify(queryParams)}`
//     );

//     return await executeQuery(queryParams);
//   } catch (error) {
//     logger.error("Error parsing query:", error);
//     return "I couldn't understand that query. Please try again with a different wording.";
//   }
// }

// Function to execute database queries based on parsed parameters
// async function executeQuery(params) {
//   let query = supabase.from("leave-table").select("*");

//   // Add filters based on queryParams
//   if (params.category) {
//     query = query.eq("category", params.category);
//   }

//   // Handle time frame
//   if (params.timeFrame) {
//     const { start, end } = calculateTimeRange(params.timeFrame);
//     query = query.gte("timestamp", start).lte("timestamp", end);
//   }

//   // Execute query
//   const { data, error } = await query;

//   if (error) throw error;

//   // Format results based on query type
//   switch (params.queryType) {
//     case "count":
//       if (params.groupBy === "user") {
//         const userCounts = {};
//         data.forEach((record) => {
//           userCounts[record.user_name] =
//             (userCounts[record.user_name] || 0) + 1;
//         });
//         return formatCountResponse(userCounts, params);
//       } else {
//         return `Found ${data.length} records matching your query.`;
//       }
//     case "list":
//       return formatListResponse(data, params);
//     case "trend":
//       return formatTrendResponse(data, params);
//     case "summary":
//       return formatSummaryResponse(data, params);
//     default:
//       return `Found ${data.length} records matching your query.`;
//   }
// }

// Helper function to calculate date ranges
// function calculateTimeRange(timeFrame) {
//   const now = new Date();
//   let start,
//     end = new Date();

//   if (typeof timeFrame === "object" && timeFrame.start && timeFrame.end) {
//     return {
//       start: new Date(timeFrame.start).toISOString(),
//       end: new Date(timeFrame.end).toISOString(),
//     };
//   }

//   switch (timeFrame) {
//     case "day":
//       start = new Date(now.setHours(0, 0, 0, 0));
//       break;
//     case "week":
//       start = new Date(now);
//       start.setDate(now.getDate() - 7);
//       break;
//     case "month":
//       start = new Date(now);
//       start.setMonth(now.getMonth() - 1);
//       break;
//     case "quarter":
//       start = new Date(now);
//       start.setMonth(now.getMonth() - 3);
//       break;
//     default:
//       start = new Date(now);
//       start.setDate(now.getDate() - 7); // Default to last week
//   }

//   return { start: start.toISOString(), end: end.toISOString() };
// }

// Helper functions to format responses
// function formatCountResponse(counts, params) {
//   if (Object.keys(counts).length === 0) return "No matching records found.";

//   const category = params.category || "attendance records";
//   const timeFrame = formatTimeFrameText(params.timeFrame);

//   const sortedUsers = Object.entries(counts)
//     .sort((a, b) => b[1] - a[1])
//     .slice(0, params.limit || 5);

//   let response = `*${category.toUpperCase()} Summary for ${timeFrame}*\n\n`;

//   sortedUsers.forEach(([user, count], index) => {
//     response += `${index + 1}. ${user}: ${count} ${
//       count === 1 ? "time" : "times"
//     }\n`;
//   });

//   return response;
// }

// function formatListResponse(data, params) {
//   if (data.length === 0) return "No matching records found.";

//   const category = params.category || "attendance records";
//   const timeFrame = formatTimeFrameText(params.timeFrame);
//   const limit = params.limit || 10;

//   let response = `*${category.toUpperCase()} Records for ${timeFrame}*\n\n`;

//   data.slice(0, limit).forEach((record, index) => {
//     const date = new Date(record.timestamp).toLocaleDateString();
//     response += `${index + 1}. ${record.user_name} - ${date}: "${
//       record.message
//     }"\n`;
//   });

//   if (data.length > limit) {
//     response += `\n_...and ${data.length - limit} more records_`;
//   }

//   return response;
// }

// function formatTrendResponse(data, params) {
//   if (data.length === 0) return "No matching records found.";

//   const category = params.category || "attendance records";
//   const timeFrame = formatTimeFrameText(params.timeFrame);

//   // Group by date
//   const dailyCounts = {};
//   data.forEach((record) => {
//     const date = new Date(record.timestamp).toLocaleDateString();
//     dailyCounts[date] = (dailyCounts[date] || 0) + 1;
//   });

//   let response = `*${category.toUpperCase()} Trend for ${timeFrame}*\n\n`;

//   Object.entries(dailyCounts)
//     .sort((a, b) => new Date(a[0]) - new Date(b[0]))
//     .forEach(([date, count]) => {
//       const bars = "█".repeat(Math.min(Math.ceil(count / 2), 10));
//       response += `${date}: ${bars} (${count})\n`;
//     });

//   return response;
// }

// function formatSummaryResponse(data, params) {
//   if (data.length === 0) return "No matching records found.";

//   const timeFrame = formatTimeFrameText(params.timeFrame);

//   // Group by category
//   const categoryCounts = {};
//   data.forEach((record) => {
//     categoryCounts[record.category] =
//       (categoryCounts[record.category] || 0) + 1;
//   });

//   // Count unique users
//   const uniqueUsers = new Set(data.map((record) => record.user_id)).size;

//   let response = `*Attendance Summary for ${timeFrame}*\n\n`;
//   response += `Total Records: ${data.length}\n`;
//   response += `Unique Users: ${uniqueUsers}\n\n`;
//   response += `*Breakdown by Category:*\n`;

//   Object.entries(categoryCounts)
//     .sort((a, b) => b[1] - a[1])
//     .forEach(([category, count]) => {
//       const percentage = Math.round((count / data.length) * 100);
//       response += `${category}: ${count} (${percentage}%)\n`;
//     });

//   return response;
// }

// function formatTimeFrameText(timeFrame) {
//   if (typeof timeFrame === "object" && timeFrame.start && timeFrame.end) {
//     return `${new Date(timeFrame.start).toLocaleDateString()} to ${new Date(
//       timeFrame.end
//     ).toLocaleDateString()}`;
//   }

//   switch (timeFrame) {
//     case "day":
//       return "Today";
//     case "week":
//       return "Past Week";
//     case "month":
//       return "Past Month";
//     case "quarter":
//       return "Past Quarter";
//     default:
//       return "Selected Period";
//   }
// }
