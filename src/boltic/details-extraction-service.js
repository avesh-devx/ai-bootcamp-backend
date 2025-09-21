const axios = require("axios");
const { format, addDays } = require("date-fns");

/**
 * Details Extraction Service for Boltic Workflows
 * Sends message + prompt to Boltic AI workflow for accurate date parsing and details extraction
 */

// Boltic workflow URL for AI details extraction
const BOLTIC_DETAILS_WORKFLOW_URL =
  process.env.BOLTIC_WORKFLOW ||
  "https://asia-south1.workflow.boltic.app/d6ed0331-7110-4c63-9251-c34e90ae8098";

// Comprehensive details extraction prompt for AI
const DETAILS_EXTRACTION_PROMPT = `You are an advanced AI designed to function as the Chief Attendance and Leave Management System for a large, international corporation ("Globex Corp"). Accuracy, comprehensive handling of various leave types, and adherence to corporate policies are paramount. Your output will be used for payroll, compliance, and resource planning.

CURRENT DATE & TIME CONTEXT:
- Today's date: ${format(new Date(), "yyyy-MM-dd")}
- Current day of week: ${format(new Date(), "EEEE")}
- Current month: ${format(new Date(), "MMMM yyyy")}
- Current year: ${new Date().getFullYear()}
- Current time: ${format(new Date(), "HH:mm:ss")}
- Current timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}

ANALYZE THIS MESSAGE WITH EXTREME PRECISION: {message}

Start date should be extracted based on the user's timezone.

Key Responsibilities:

1. **Data Extraction & Interpretation:** Thoroughly analyze employee communications to precisely determine the type of absence (leave, work from home, late arrival, early departure), the start date, the end date (or duration), and any stated reasons.
2. **Date & Time Standardization:** Convert all dates and times to a single, consistent format: ISO 8601 (YYYY-MM-DD). Assume the company timezone is EST (Eastern Standard Time). All timings should be represented in 24 hour format.
3. **Duration Calculation:** Calculate leave durations with extreme precision, considering weekends, company holidays, and partial days. Use the provided conversion chart for time unit calculations.
4. **Policy Enforcement:** Ensure that all requests comply with Globex Corp's leave policies. Identify potential violations and flag them appropriately.
5. **Edge Case Handling:** Identify and resolve ambiguous or conflicting requests.
6. **Output Formatting:** Generate a structured JSON output containing all extracted and calculated information.

Approach & Methodology:

Follow these steps meticulously:

1. **Message Intake & Preprocessing:**
   1. Receive the employee message as a string.
   2. Clean the input by removing unnecessary characters, correcting common typos, and handling variations in phrasing.
   3. Language Understanding: Use natural language processing (NLP) to understand the intent of the message.

2. **Absence Type Classification:**
    Determine the primary type of absence being requested. Possible categories include:
     wfh: Work from home request
     full_leave: Full day absence
     half_leave: Half day absence
     leave_early: Notification of leaving work early
     come_late: Notification of arriving late to work

3. **Date & Time Extraction:**
   1. Identify all date and time mentions within the message.
   2. Handle relative references (e.g., "next Tuesday," "two weeks from today"). Use the current date as the anchor point.
   3. Resolve ambiguous dates by considering the context of the message.
   4. For expressions like "the 25th of the next month" - extract both the day (25th) and the month reference (next month) correctly.
   5. Convert all extracted dates and times to ISO 8601 format (YYYY-MM-DD) and EST timezone.
   6. Calculate end date if only duration is given, excluding weekends and company holidays.

4. **Duration Calculation:**
   Calculate the duration of the absence in days using the following conversion factors:
     1 hour = 0.125 days
     1 day = 1 day
     1 week = 5 days (assuming standard 5-day work week - excluding weekend)
     1 month = 20 days (average working days in a month)
     1 quarter = 60 days (average working days in a quarter)
     1 year = 240 days (average working days in a year)

DATE REFERENCE POINTS (USE CURRENT DATE AS BASE):
- "today" = ${format(new Date(), "yyyy-MM-dd")} (${format(new Date(), "EEEE")})
- "tomorrow" = ${format(addDays(new Date(), 1), "yyyy-MM-dd")} (${format(
  addDays(new Date(), 1),
  "EEEE"
)})
- "yesterday" = ${format(addDays(new Date(), -1), "yyyy-MM-dd")} (${format(
  addDays(new Date(), -1),
  "EEEE"
)})
- "next week" = starting ${format(
  addDays(new Date(), 7),
  "yyyy-MM-dd"
)} (${format(addDays(new Date(), 7), "EEEE")})
- "next month" = ${format(
  addDays(new Date(), 30),
  "MMMM yyyy"
)} (starting on the 1st)
- "next quarter" = starting on the 1st of next quarter

WEEKDAY CALCULATIONS (CRITICAL FOR "NEXT TUESDAY" TYPE REQUESTS):
Current day is ${format(
  new Date(),
  "EEEE"
)}. Calculate relative weekdays accurately:
- If today is ${format(new Date(), "EEEE")}, then:
  - Next Monday = ${format(
    addDays(new Date(), (8 - new Date().getDay()) % 7 || 7),
    "yyyy-MM-dd"
  )}
  - Next Tuesday = ${format(
    addDays(new Date(), (9 - new Date().getDay()) % 7 || 7),
    "yyyy-MM-dd"
  )}
  - Next Wednesday = ${format(
    addDays(new Date(), (10 - new Date().getDay()) % 7 || 7),
    "yyyy-MM-dd"
  )}
  - Next Thursday = ${format(
    addDays(new Date(), (11 - new Date().getDay()) % 7 || 7),
    "yyyy-MM-dd"
  )}
  - Next Friday = ${format(
    addDays(new Date(), (12 - new Date().getDay()) % 7 || 7),
    "yyyy-MM-dd"
  )}
  - Next Saturday = ${format(
    addDays(new Date(), (13 - new Date().getDay()) % 7 || 7),
    "yyyy-MM-dd"
  )}
  - Next Sunday = ${format(
    addDays(new Date(), (14 - new Date().getDay()) % 7 || 7),
    "yyyy-MM-dd"
  )}

DATE PARSING RULES:
- When a message mentions "the Xth of the next month", the startDate should be set to the Xth day of the next month, NOT the 1st day of the next month.
- Example: "I'm not available on the 25th of the next month" should set startDate to the 25th day of ${format(
  addDays(new Date(), 30),
  "MMMM yyyy"
)}.

DURATION CALCULATION PROTOCOL:
1. ALWAYS calculate endDate = startDate + (durationDays - 1)
2. For "X days" → durationDays = X
3. For "X weeks" → durationDays = X * 7
4. For "X months" → durationDays = X * 30
5. For "X years" → durationDays = X * 365
6. For "X hours" → durationDays = 1 (same day)
7. For "half day", "half-day", "partial day", "morning off", "afternoon off" → durationDays = 0.5

SPECIAL CASE HANDLING:
1. For half day leave or partial availability: If a message indicates partial availability or half-day leave on a specific date, set durationDays = 0.5 and endDate = startDate.

2. For specific date mentions: When the message only mentions a specific date without indicating a multi-day period, set durationDays = 1 and calculate endDate = startDate.

3. For expressions like "the Xth of next month": Parse these as the Xth day of the next calendar month, not as the first day of the next month.

4. CRITICAL HALF DAY DETECTION: If message contains "half day", "half-day", "half leave", "partial day", "morning off", "afternoon off", "0.5 days", "4 hours" → ALWAYS set durationDays = 0.5

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
✓ startDate: ${new Date().getFullYear()}-04-20
✓ durationDays: 0.5
✓ endDate: ${new Date().getFullYear()}-04-20

SCENARIO 3: SPECIFIC DATE IN NEXT MONTH
Example: "I'm not available on the 25th of the next month"
✓ isWorkingFromHome: false
✓ isLeaveRequest: true
✓ startDate: ${format(
  new Date(new Date().getFullYear(), new Date().getMonth() + 1, 25),
  "yyyy-MM-dd"
)} (25th of ${format(addDays(new Date(), 30), "MMMM yyyy")})
✓ durationDays: 1
✓ endDate: ${format(
  new Date(new Date().getFullYear(), new Date().getMonth() + 1, 25),
  "yyyy-MM-dd"
)}

SCENARIO 4: DAYS AFTER A SPECIFIC DATE
Example: "I'm not available for 3 days after the 15th of the next month"
✓ isWorkingFromHome: false
✓ isLeaveRequest: true
✓ startDate: ${format(
  new Date(new Date().getFullYear(), new Date().getMonth() + 1, 16),
  "yyyy-MM-dd"
)} (day AFTER the 15th of ${format(addDays(new Date(), 30), "MMMM yyyy")})
✓ durationDays: 3
✓ endDate: ${format(
  new Date(new Date().getFullYear(), new Date().getMonth() + 1, 18),
  "yyyy-MM-dd"
)}

SCENARIO 5: COMPLEX RELATIVE DATES
Example: "I'm on leave for three days from next tuesday"
✓ isWorkingFromHome: false
✓ isLeaveRequest: true
✓ startDate: ${format(
  addDays(new Date(), (9 - new Date().getDay()) % 7 || 7),
  "yyyy-MM-dd"
)} [next Tuesday from ${format(new Date(), "yyyy-MM-dd")}]
✓ durationDays: 3
✓ endDate: ${format(
  addDays(new Date(), (9 - new Date().getDay()) % 7 || 7 + 2),
  "yyyy-MM-dd"
)} [startDate + 2 days]

SCENARIO 6: HOURS-BASED TIMING
Example: "Coming in 2 hours late tomorrow"
✓ isWorkingFromHome: false
✓ isLeaveRequest: false
✓ isRunningLate: true
✓ startDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [tomorrow]
✓ durationDays: 1
✓ endDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [same as startDate]

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
2. For any single day absence (including half-day or partial availability), set durationDays = 0.5 and endDate = startDate.
3. For multi-day absences, calculate endDate = startDate + (durationDays - 1).
4. For date expressions like "the 25th of the next month", extract the specific day mentioned (25th), not just the general period (next month).
5. If the end date would be after the start date, or if the message mentions a duration (e.g., "for X days"), you MUST calculate and provide the correct end date. Failure to do so would violate company policy and could result in payroll errors.

User message: {message}

Return response in JSON format:
{
  "isWorkingFromHome": false,
  "isLeaveRequest": true,
  "isRunningLate": false,
  "isLeavingEarly": false,
  "reason": "extracted reason or null",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "durationDays": 1,
  "additionalDetails": {
    "originalMessage": "original message",
    "extractedAt": "ISO timestamp"
  }
}`;

// Call Boltic AI workflow for details extraction
async function extractDetailsWithAI(message) {
  try {
    const prompt = DETAILS_EXTRACTION_PROMPT.replace(/{message}/g, message);

    const payload = {
      prompt: prompt,
      message: message,
    };

    const headers = {
      "Content-Type": "application/json",
    };

    console.log("Sending details extraction request to Boltic workflow...");

    const response = await axios.post(BOLTIC_DETAILS_WORKFLOW_URL, payload, {
      headers,
    });

    console.log(
      "Response from Boltic workflow:",
      JSON.stringify(response.data)
    );

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
            aiResult = parseTextResponse(aiText, message);
          }
        }
      } else if (typeof response.data === "string") {
        // If response is string, try to extract JSON
        const jsonMatch = response.data.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback parsing for plain text response
          aiResult = parseTextResponse(response.data, message);
        }
      } else {
        aiResult = response.data;
      }

      // Ensure all required fields are present
      return {
        isWorkingFromHome: aiResult.isWorkingFromHome || false,
        isLeaveRequest: aiResult.isLeaveRequest || false,
        isRunningLate: aiResult.isRunningLate || false,
        isLeavingEarly: aiResult.isLeavingEarly || false,
        reason: aiResult.reason || null,
        startDate: aiResult.startDate || format(new Date(), "yyyy-MM-dd"),
        endDate: aiResult.endDate || format(new Date(), "yyyy-MM-dd"),
        durationDays: aiResult.durationDays || 1,
        additionalDetails: {
          originalMessage: message,
          extractedAt: new Date().toISOString(),
        },
      };
    }

    throw new Error("No response from Boltic workflow");
  } catch (error) {
    console.error("Boltic workflow error:", error.message);

    // Fallback to simple extraction if AI fails
    return fallbackDetailsExtraction(message);
  }
}

// Fallback details extraction if AI workflow fails
function fallbackDetailsExtraction(message) {
  const msg = message.toLowerCase();
  const today = new Date();

  let startDate = format(today, "yyyy-MM-dd");
  let endDate = format(today, "yyyy-MM-dd");
  let durationDays = 1;
  let isWorkingFromHome = false;
  let isLeaveRequest = false;
  let isRunningLate = false;
  let isLeavingEarly = false;
  let reason = null;

  // Determine type flags
  if (
    msg.includes("wfh") ||
    msg.includes("work from home") ||
    msg.includes("remote")
  ) {
    isWorkingFromHome = true;
  } else if (
    msg.includes("leave") ||
    msg.includes("off") ||
    msg.includes("vacation")
  ) {
    isLeaveRequest = true;
  } else if (msg.includes("late") || msg.includes("delayed")) {
    isRunningLate = true;
  } else if (msg.includes("leaving early") || msg.includes("early departure")) {
    isLeavingEarly = true;
  }

  // Check for half day leave first (more specific)
  if (
    msg.includes("half day") ||
    msg.includes("half-day") ||
    msg.includes("half leave") ||
    msg.includes("partial day") ||
    msg.includes("morning off") ||
    msg.includes("afternoon off") ||
    msg.includes("0.5 days") ||
    msg.includes("4 hours") ||
    msg.includes("morning only") ||
    msg.includes("afternoon only")
  ) {
    durationDays = 0.5;
    isLeaveRequest = true;
  }

  // Simple date extraction for fallback
  if (msg.includes("tomorrow")) {
    startDate = format(addDays(today, 1), "yyyy-MM-dd");
    endDate = startDate;
  } else if (msg.includes("next week")) {
    startDate = format(addDays(today, 7), "yyyy-MM-dd");
    if (durationDays === 1) {
      durationDays = 5;
    }
    endDate = format(
      addDays(new Date(startDate), durationDays - 1),
      "yyyy-MM-dd"
    );
  }

  // Extract duration for fallback (only if not already set to 0.5)
  if (durationDays !== 0.5) {
    const durationMatch = message.match(/(\d+)\s+days?/i);
    if (durationMatch) {
      durationDays = parseInt(durationMatch[1]);
    }
  }

  // Calculate end date (for half day, endDate = startDate)
  if (durationDays === 0.5) {
    endDate = startDate;
  } else if (durationDays > 1) {
    endDate = format(
      addDays(new Date(startDate), durationDays - 1),
      "yyyy-MM-dd"
    );
  }

  return {
    isWorkingFromHome,
    isLeaveRequest,
    isRunningLate,
    isLeavingEarly,
    reason,
    startDate,
    endDate,
    durationDays,
    additionalDetails: {
      originalMessage: message,
      extractedAt: new Date().toISOString(),
    },
  };
}

// Parse text response from AI if JSON parsing fails
function parseTextResponse(textResponse, message) {
  const text = textResponse.toLowerCase();
  const today = new Date();

  let result = {
    isWorkingFromHome: false,
    isLeaveRequest: false,
    isRunningLate: false,
    isLeavingEarly: false,
    reason: null,
    startDate: format(today, "yyyy-MM-dd"),
    endDate: format(today, "yyyy-MM-dd"),
    durationDays: 1,
    additionalDetails: {
      originalMessage: message,
      extractedAt: new Date().toISOString(),
    },
  };

  // Try to extract boolean flags
  if (text.includes("workingfromhome") || text.includes("wfh")) {
    result.isWorkingFromHome = true;
  }
  if (text.includes("leaverequest") || text.includes("leave")) {
    result.isLeaveRequest = true;
  }
  if (text.includes("runninglate") || text.includes("late")) {
    result.isRunningLate = true;
  }
  if (text.includes("leavingearly") || text.includes("early")) {
    result.isLeavingEarly = true;
  }

  // Try to extract dates
  const dateMatch = text.match(/startdate[:\s]*["']?(\d{4}-\d{2}-\d{2})["']?/i);
  if (dateMatch) {
    result.startDate = dateMatch[1];
  }

  const endDateMatch = text.match(
    /enddate[:\s]*["']?(\d{4}-\d{2}-\d{2})["']?/i
  );
  if (endDateMatch) {
    result.endDate = endDateMatch[1];
  }

  const durationMatch = text.match(/durationdays[:\s]*(\d+)/i);
  if (durationMatch) {
    result.durationDays = parseInt(durationMatch[1]);
  }

  return result;
}

// API endpoint for Boltic to call
async function handleDetailsExtractionRequest(message) {
  try {
    if (!message) {
      throw new Error("Message is required");
    }

    const result = await extractDetailsWithAI(message);

    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Details extraction error:", error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  handleDetailsExtractionRequest,
};
