const axios = require("axios");

const API_URL =
  "https://asia-south1.workflow.boltic.app/c826b3b8-e22b-4f14-8b12-b1af45ea8ff0";
const requestData = { prompt: "Hello, what is 2 + 2 ?" };
const headers = {
  "Content-Type": "application/json",
};

axios
  .post(API_URL, requestData, { headers })
  .then((response) => {
    console.log("Request was successful.");
    console.log("Response:", response.data);
  })
  .catch((error) => {
    console.error("Request failed:", error);
  });
