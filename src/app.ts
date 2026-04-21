import express from "express";
import dotenv from "dotenv";
import { createConfiguredApp } from "./config.js";

dotenv.config();

// Vercel's Express detector expects the entry module itself to import `express`.
const expressEntrypointMarker = express;
void expressEntrypointMarker;

const app = createConfiguredApp();

export default app;
