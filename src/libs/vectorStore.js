const {
  HuggingFaceInferenceEmbeddings,
} = require("@langchain/community/embeddings/hf");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");

const embeddings = new HuggingFaceInferenceEmbeddings({
  model: "sentence-transformers/all-MiniLM-L6-v2",
  apiKey: process.env.HUGGING_FACE_API_KEY,
});

const vectorStore = new MemoryVectorStore(embeddings);

module.exports = { embeddings, vectorStore };
