const { PromptTemplate } = require("@langchain/core/prompts");
const { vectorStore } = require("../libs/vectorStore");
const {
  format,
  addDays,
  nextMonday,
  nextTuesday,
  nextWednesday,
  nextThursday,
  nextFriday,
  nextSaturday,
  nextSunday,
} = require("date-fns");

// Function to retrieve similar examples
async function getSimilarExamples(message, k = 3) {
  try {
    const results = await vectorStore.similaritySearch(message, k);
    return results;
  } catch (error) {
    console.error("Error retrieving similar examples:", error);
    return [];
  }
}

// Function to get the next occurrence of a day of week
function getNextDayOccurrence(targetDayNumber) {
  const today = new Date();
  const currentDayNumber = today.getDay(); // 0 (Sunday) to 6 (Saturday)

  let daysToAdd;
  if (currentDayNumber === targetDayNumber) {
    // If today is the target day, get next week's occurrence (add 7 days)
    daysToAdd = 7;
  } else if (currentDayNumber < targetDayNumber) {
    // If target day is later this week
    daysToAdd = targetDayNumber - currentDayNumber;
  } else {
    // If target day has passed this week, get next week's occurrence
    daysToAdd = 7 - (currentDayNumber - targetDayNumber);
  }

  return format(addDays(today, daysToAdd), "yyyy-MM-dd");
}

// Function to calculate day-of-week examples for the prompt
function generateDayExamples() {
  const today = new Date();
  const dayMap = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
  };

  const currentDay = today.getDay();
  const currentDayName = dayMap[currentDay];

  let examples = [];

  // Generate examples for each day of the week
  for (let targetDay = 0; targetDay < 7; targetDay++) {
    const targetDayName = dayMap[targetDay];
    let daysToAdd;

    if (currentDay === targetDay) {
      // If today is the target day, get next week's occurrence
      daysToAdd = 7;
    } else if (currentDay < targetDay) {
      // If target day is later this week
      daysToAdd = targetDay - currentDay;
    } else {
      // If target day has passed this week, get next week's occurrence
      daysToAdd = 7 - (currentDay - targetDay);
    }

    const calculatedDate = format(addDays(today, daysToAdd), "yyyy-MM-dd");

    examples.push(
      `- Example: "I'm on leave ${targetDayName}" → startDate: ${calculatedDate} (${
        daysToAdd === 7 ? "next" : "this"
      } ${targetDayName})`
    );
  }

  return examples.join("\n");
}

// Dynamic prompt creation function
const createDynamicDetailsPrompt = async (message) => {
  try {
    // Get similar examples
    const similarExamples = await getSimilarExamples(message);

    let examplesText = "";

    if (similarExamples.length > 0) {
      // Format examples for the prompt
      examplesText =
        "Here are some similar examples of how to parse attendance messages:\n\n" +
        similarExamples
          .map((example) => {
            try {
              const [exMsg, exResult] =
                example.pageContent.split("\nParsed Result:");
              return `EXAMPLE:\n${exMsg.replace(
                "Message: ",
                ""
              )}\nRESULT:${exResult}`;
            } catch (error) {
              console.error("Error formatting example:", error);
              return "";
            }
          })
          .filter((ex) => ex !== "")
          .join("\n\n");
    }

    // Calculate next occurrences of each day of the week for reference
    const nextMondayDate = format(nextMonday(new Date()), "yyyy-MM-dd");
    const nextTuesdayDate = format(nextTuesday(new Date()), "yyyy-MM-dd");
    const nextWednesdayDate = format(nextWednesday(new Date()), "yyyy-MM-dd");
    const nextThursdayDate = format(nextThursday(new Date()), "yyyy-MM-dd");
    const nextFridayDate = format(nextFriday(new Date()), "yyyy-MM-dd");
    const nextSaturdayDate = format(nextSaturday(new Date()), "yyyy-MM-dd");
    const nextSundayDate = format(nextSunday(new Date()), "yyyy-MM-dd");

    // Generate day of week reference examples based on today
    const dayOfWeekExamples = generateDayExamples();

    // Create enhanced prompt template
    return PromptTemplate.fromTemplate(
      `You are an advanced AI designed to function as the Chief Attendance and Leave Management System for a large, international corporation ("Globex Corp"). Accuracy, comprehensive handling of various leave types, and adherence to corporate policies are paramount. Your output will be used for payroll, compliance, and resource planning. Assume all communications are in written form (email, chat, etc.).

  Today's date is ${format(new Date(), "yyyy-MM-dd")}.
  Current day of the week is ${format(new Date(), "EEEE")}.
  
  ANALYZE THIS MESSAGE WITH EXTREME PRECISION: {message}

  Start date should be extracted based on the user's timezone.

  Temporal Context Primer:
- Current Date: ${format(new Date(), "yyyy-MM-dd")} (${format(
        new Date(),
        "EEEE"
      )})
- Current Day Number: ${new Date().getDay()} (Sunday=0 to Saturday=6)
- Reference Timezone: EST (Eastern Standard Time)

Enhanced Date Resolution Protocol:

1. Day-of-Week Analysis (CRITICAL SECTION):
   When processing unqualified day references (e.g., "Monday" without "this" or "next"):
   
   * IMPORTANT! If a message only mentions a day name (e.g., "I'm on leave Monday"):
   
     a. IF today IS that day → Use NEXT week's occurrence of that day
        Example: If today is Monday (day 1) and user says "Monday", use NEXT Monday
   
     b. IF today comes BEFORE that day in the week → Use THIS week's occurrence
        Example: If today is Tuesday (day 2) and user says "Friday" (day 5), use THIS Friday
   
     c. IF today comes AFTER that day in the week → Use NEXT week's occurrence
        Example: If today is Wednesday (day 3) and user says "Monday" (day 1), use NEXT Monday
   
   Day Number Reference: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6
   Current Day Number: ${new Date().getDay()}
   Current Day Name: ${format(new Date(), "EEEE")}
   
   Next occurrences of each day (for reference):
   - Next Monday: ${nextMondayDate}
   - Next Tuesday: ${nextTuesdayDate}
   - Next Wednesday: ${nextWednesdayDate}
   - Next Thursday: ${nextThursdayDate}
   - Next Friday: ${nextFridayDate}
   - Next Saturday: ${nextSaturdayDate}
   - Next Sunday: ${nextSundayDate}

2. Relative Date Calculus:
   - Implement date algebra for expressions like:
     - "3 days after next Tuesday"
     - "Week after next Wednesday"
     - "Second Friday of next month"
   - Use recursive date resolution with overflow handling between months/years

3. Temporal Boundary Conditions:
   - End-of-month scenarios:
     - "Last working day of March" → 31st (adjust for weekends/holidays)
     - "First Monday of April" → Calculate first occurrence
   - Handle year transitions:
     - "December 29th to January 3rd" → Split across years

Critical Date Calculation Formula:
  When processing day-of-week requests:
  - If today IS the mentioned day → Use NEXT week's occurrence (today + 7 days)
  - If today comes BEFORE the mentioned day → Use THIS week's occurrence (today + (target_day - current_day))
  - If today comes AFTER the mentioned day → Use NEXT week's occurrence (today + (7 - (current_day - target_day)))

  Current Date Context:
  - TODAY: ${format(new Date(), "yyyy-MM-dd")}
  - CURRENT_DAY_NUM: ${new Date().getDay()}
  - CURRENT_DAY_NAME: ${format(new Date(), "EEEE")}

  Live Calculation Examples Based On Today:
  ${dayOfWeekExamples}

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
     7. CRITICAL: For day-of-week mentions without qualifiers (e.g., just "Monday" without "next" or "this"), apply the following rules:
         - If today IS the mentioned day: Use NEXT week's occurrence (today + 7 days)
         - If today comes BEFORE the mentioned day in the week: Use THIS week's occurrence
         - If today comes AFTER the mentioned day in the week: Use NEXT week's occurrence

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
  
  DAY OF WEEK REFERENCE LOGIC (CRITICAL COMPONENT):
  Sunday = 0, Monday = 1, Tuesday = 2, Wednesday = 3, Thursday = 4, Friday = 5, Saturday = 6
  - Current day of the week (numeric): ${new Date().getDay()}
  - Current day name: ${format(new Date(), "EEEE")}
  
  MOST CRITICAL RULE: For simple day references without qualifiers:
  - If today IS that day → Use NEXT week's occurrence (today + 7 days)
  - If today comes BEFORE that day → Use THIS week's occurrence
  - If today comes AFTER that day → Use NEXT week's occurrence
  
  Examples based on current date:
  ${dayOfWeekExamples}
  
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
  
  4. For unqualified day references: When the message only mentions a day of the week (e.g., "I'm on leave Friday"):
     - Use the critical day-of-week resolution rules at the top of this prompt
     - Calculate the exact date accordingly using the formulas provided
     - Triple-check your calculations for accuracy

  5. For day ranges: When the message indicates a range using days of the week (e.g., "on leave Monday to Wednesday"):
     - Apply the same logic as unqualified days to determine which Monday and Wednesday
     - If the range spans current and next week, handle accordingly
  
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

  SCENARIO 4: DAYS AFTER A SPECIFIC DATE
  Example: "I'm not available for 3 days after the 15th of the next month"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: 2025-04-16 (assuming current month is March - this is the day AFTER the 15th)
  ✓ durationDays: 3
  ✓ endDate: 2025-04-18

  SCENARIO 5: HOURS-BASED TIMING
  Example: "Coming in 2 hours late tomorrow"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: false
  ✓ isRunningLate: true
  ✓ startDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [tomorrow]
  ✓ durationDays: 1
  ✓ endDate: ${format(addDays(new Date(), 1), "yyyy-MM-dd")} [same as startDate]

  SCENARIO 6: SIMPLE DAY OF WEEK REFERENCE (MOST CRITICAL SCENARIO)
  Example: "I'm on leave Monday"
  
  Apply the critical day-of-week logic:
  - If today is Monday (day 1): Use NEXT Monday (today + 7 days)
  - If today is before Monday (e.g., Sunday, day 0): Use THIS Monday (today + 1 day) 
  - If today is after Monday (e.g., Tuesday through Saturday): Use NEXT Monday
  
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: [calculated date using the critical rules above]
  ✓ durationDays: 1
  ✓ endDate: [same as startDate]

  SCENARIO 7: DAY RANGE REFERENCE
  Example: "Out of office Monday through Wednesday"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: [calculate the correct date for Monday based on current day]
  ✓ durationDays: 3
  ✓ endDate: [calculate the correct date - startDate + 2 days]

  SCENARIO 8: IMPLICIT "NEXT" FOR SAME DAY REFERENCES
  Example: If today is Monday and user says "I'm on leave Monday"
  ✓ isWorkingFromHome: false
  ✓ isLeaveRequest: true
  ✓ startDate: [NEXT Monday - exactly 7 days from today]
  ✓ durationDays: 1
  ✓ endDate: [same as startDate]

  SCENARIO 9: HOLIDAY ADJACENT REQUESTS
  Example: "Leave December 24-26" → 
  - Check Christmas (Dec 25) in holidays
  - Calculate duration excluding holidays

  Temporal Resolution Workflow:

  1. Lexical Analysis:
     - Tokenize temporal terms using regex:
       /(\b(next|following)\s+|\bthis\s+)?(mon|tues|wednes|thurs|fri|satur|sun)day\b/gi
     - Detect implicit time references through modal verbs:
       - "Will be out..." → Future tense
       - "Was absent..." → Past tense (handle differently)

  2. Contextual Disambiguation:
     - Maintain conversation history buffer
     - Resolve pronoun references:
       - "That Friday" → Previous mention in conversation
       - "The following Monday" → Relative to discussed dates

  3. Temporal Validation:
     - Cross-verify resolved dates against:
       - Company holiday calendar
       - Known company events (from vector store)
       - User's historical leave patterns

  Compliance Enforcement:
  - Implement 3-step verification:
    1. Raw NLP extraction
    2. Contextual adjustment
    3. Policy alignment check

  Enhanced Output Sanitization:
  - Add temporal sanity checks:
    if (endDate < startDate) {
      throw new TemporalParadoxError();
    }
    if (durationDays !== (endDate - startDate + 1)) {
      recalculateDuration();
    }

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
  5. If the end date would be after the start date, or if the message mentions a duration (e.g., "for X days"), you MUST calculate and provide the correct end date. Failure to do so would violate company policy and could result in payroll errors.
  6. ALWAYS ensure relative day references (e.g., just "Friday" without qualification) are correctly calculated based on the current date.
  
  {format_instructions}`
    );
  } catch (error) {
    console.error("Error creating dynamic prompt:", error);
    return "";
  }
};

module.exports = {
  createDynamicDetailsPrompt,
};
