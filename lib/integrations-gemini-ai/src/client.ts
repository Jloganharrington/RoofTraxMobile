import { GoogleGenAI } from "@google/genai";

if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_BASE_URL must be set. Did you forget to provision the Gemini AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Did you forget to provision the Gemini AI integration?",
  );
}

// The provisioned base URL may or may not include a scheme; the SDK requires
// a fully-qualified URL, so normalize it here.
const rawBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const baseUrl = /^https?:\/\//.test(rawBaseUrl)
  ? rawBaseUrl
  : `https://${rawBaseUrl}`;

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl,
  },
});
