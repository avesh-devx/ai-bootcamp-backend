const axios = require("axios");

const BOLTIC_BASE_URL =
  "https://asia-south1.workflow.boltic.app/c826b3b8-e22b-4f14-8b12-b1af45ea8ff0";

// Global Axios instance for Boltic API
const bolticAPI = axios.create({
  baseURL: BOLTIC_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000, // 30 seconds timeout
});

module.exports = {
  bolticAPI,
};
