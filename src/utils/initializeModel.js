const { HuggingFaceInference } = require("@langchain/community/llms/hf");
const dotenv = require("dotenv");

dotenv.config();

// const aiModel = new HuggingFaceInference({
//   model: "mistralai/Mistral-7B-Instruct-v0.2", // Your HF model
//   apiKey: process.env.HUGGING_FACE_API_KEY, // Your Hugging Face API Key
//   temperature: 0.1,
// });

// const aiModel = new HuggingFaceInference({
//   model: "google/flan-t5-small", // Your HF model
//   apiKey: process.env.HUGGING_FACE_API_KEY, // Your Hugging Face API Key
//   temperature: 0.1,
// });

let aiModel = null;

function initializeAIModel() {
  if (!aiModel) {
    aiModel = new HuggingFaceInference({
      model: "gpt2",
      temperature: 0.7,
      maxTokens: 50,
      apiKey: process.env.HUGGING_FACE_API_KEY,
    });
  }
  return aiModel;
}

function getAiModel() {
  if (!aiModel) {
    initializeAIModel();
  }
  return aiModel;
}

module.exports = {
  getAiModel,
};
