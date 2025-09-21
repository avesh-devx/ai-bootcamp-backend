const axios = require("axios");

/**
 * Classification Service for Boltic Workflows
 * Sends message + prompt to Boltic AI workflow for accurate categorization
 */

// Boltic workflow URL for AI classification
const BOLTIC_CLASSIFICATION_WORKFLOW_URL =
  process.env.BOLTIC_WORKFLOW ||
  "https://asia-south1.workflow.boltic.app/d6ed0331-7110-4c63-9251-c34e90ae8098";

// Classification prompt for AI
const CLASSIFICATION_PROMPT = `Employee Message Categorization Prompt
You are an AI assistant that categorizes employee messages into specific workplace attendance categories.
Your task: Analyze the user's message and return ONLY the most appropriate category name from the list below.

Categories:
- Work from home
- Half day leave
- Full day leave
- Running late or late arrival
- Early leave
- Out for office
- Other

Instructions:
1. Read the entire message carefully and understand the PRIMARY INTENT
2. Consider the CONTEXT and MEANING, not just individual keywords
3. Identify what the employee is actually planning to do
4. Match it to the most specific applicable category
5. Return only the exact category name (case-sensitive)

Key Classification Rules:

**Work from home**: Employee is working remotely (full day or partial day) - they are WORKING, not taking leave
- Keywords: "wfh", "work from home", "remote", "working from home"
- Context: Employee mentions working/productivity while being at home
- Example: "wfh today", "working from home due to back pain", "wfh in the morning"

**Half day leave**: Employee is taking LEAVE (not working) for approximately half the workday
- Keywords: "half day leave", "half-day off", "taking half day", "half day sick leave"
- Context: Employee is NOT working, taking time off for personal/medical reasons
- Example: "taking half day leave for doctor appointment", "half day off sick"

**Full day leave**: Taking leave for the entire workday
- Keywords: "full day leave", "taking leave", "off today", "sick leave"
- Context: Employee is completely unavailable for work

**Running late or late arrival**: Delayed start but will attend office
- Keywords: "running late", "will be late", "delayed"
- Context: Employee will come to office but later than usual

**Early leave**: Leaving office before scheduled end time
- Keywords: "leaving early", "early departure", "need to leave early"
- Context: Employee will leave office before normal hours

**Out for office**: Temporarily away from office during work hours
- Keywords: "out for meeting", "client visit", "appointment"
- Context: Work-related activities outside office

**Other**: Messages that don't fit the above categories

CRITICAL CONTEXT ANALYSIS:
- If message mentions "wfh" or "work from home" → prioritize "Work from home" even if "half" is mentioned
- If message mentions working/productivity while at home → "Work from home"
- If message mentions taking leave/off time → "Half day leave" or "Full day leave"
- Consider the employee's intent: Are they working or taking time off?

Response Format: Return only the category name, nothing else.
User message: {USER_MESSAGE}

Return response in JSON format:
{
  "category": "CATEGORY_NAME",
  "confidence": 0.95
}
`;

// Call Boltic AI workflow for classification
async function classifyMessageWithAI(message) {
  try {
    const prompt = CLASSIFICATION_PROMPT.replace("{USER_MESSAGE}", message);

    const payload = {
      prompt: prompt,
      message: message,
    };

    const headers = {
      "Content-Type": "application/json",
    };

    const response = await axios.post(
      BOLTIC_CLASSIFICATION_WORKFLOW_URL,
      payload,
      { headers }
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
          const jsonMatch = cleanText.match(/\{[^}]*\}/);
          if (jsonMatch) {
            aiResult = JSON.parse(jsonMatch[0]);
          } else {
            // Fallback parsing for plain text response
            aiResult = parseTextResponse(aiText, message);
          }
        }
      } else if (typeof response.data === "string") {
        // If response is string, try to extract JSON
        const jsonMatch = response.data.match(/\{[^}]*\}/);
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback parsing for plain text response
          aiResult = parseTextResponse(response.data, message);
        }
      } else {
        aiResult = response.data;
      }

      console.log("Parsed AI result:", JSON.stringify(aiResult));

      return {
        category: aiResult.category || "FULL DAY LEAVE",
        confidence: aiResult.confidence || 0.8,
      };
    }

    throw new Error("No response from Boltic workflow");
  } catch (error) {
    console.error("Boltic workflow error:", error.message);

    // Fallback to simple classification if AI fails
    return fallbackClassification(message);
  }
}

// Fallback classification if AI workflow fails
function fallbackClassification(message) {
  const msg = message.toLowerCase();

  // Prioritize WFH if work-related keywords are present
  if (
    msg.includes("wfh") ||
    msg.includes("work from home") ||
    msg.includes("working from home") ||
    msg.includes("remote") ||
    (msg.includes("work") && (msg.includes("home") || msg.includes("remote")))
  ) {
    return { category: "WFH", confidence: 0.8 };
  }

  // Check for explicit half day LEAVE (not just "half")
  if (
    msg.includes("half day leave") ||
    msg.includes("half-day leave") ||
    msg.includes("taking half day") ||
    msg.includes("half day off") ||
    msg.includes("half day sick") ||
    msg.includes("partial day leave") ||
    msg.includes("morning off") ||
    msg.includes("afternoon off")
  ) {
    return { category: "HALF DAY LEAVE", confidence: 0.8 };
  }

  // General leave detection
  if (
    msg.includes("leave") ||
    msg.includes("off today") ||
    msg.includes("sick leave") ||
    msg.includes("vacation") ||
    msg.includes("taking off")
  ) {
    return { category: "FULL DAY LEAVE", confidence: 0.7 };
  }

  if (msg.includes("late") || msg.includes("delayed")) {
    return { category: "LATE TO OFFICE", confidence: 0.6 };
  }

  if (msg.includes("leaving early") || msg.includes("early departure")) {
    return { category: "LEAVING EARLY", confidence: 0.6 };
  }

  return { category: "FULL DAY LEAVE", confidence: 0.5 };
}

// Parse text response from AI if JSON parsing fails
function parseTextResponse(textResponse, message) {
  const text = textResponse.toLowerCase();
  const originalMessage = message.toLowerCase();

  let category = "FULL DAY LEAVE";
  let confidence = 0.6;

  // Prioritize WFH if work-related context is present
  if (
    text.includes("work from home") ||
    originalMessage.includes("wfh") ||
    originalMessage.includes("work from home") ||
    originalMessage.includes("working from home") ||
    (originalMessage.includes("work") && originalMessage.includes("home"))
  ) {
    category = "WFH";
    confidence = 0.8;
  } else if (
    text.includes("half day leave") ||
    text.includes("taking half day") ||
    text.includes("half day off") ||
    text.includes("half") ||
    text.includes("partial")
  ) {
    category = "HALF DAY LEAVE";
    confidence = 0.8;
  } else if (text.includes("late")) {
    category = "LATE TO OFFICE";
    confidence = 0.8;
  } else if (text.includes("early")) {
    category = "LEAVING EARLY";
    confidence = 0.8;
  } else if (text.includes("leave") || text.includes("full day")) {
    category = "FULL DAY LEAVE";
    confidence = 0.8;
  }

  // Try to extract confidence if mentioned
  const confidenceMatch = text.match(/confidence[:\s]*([0-9.]+)/);
  if (confidenceMatch) {
    confidence = parseFloat(confidenceMatch[1]);
  }

  return { category, confidence };
}

// API endpoint for Boltic to call
async function handleClassificationRequest(message) {
  try {
    if (!message) {
      throw new Error("Message is required");
    }
    const result = await classifyMessageWithAI(message);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Classification error:", error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = {
  handleClassificationRequest,
};
