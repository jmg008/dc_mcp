import dotenv from "dotenv";
import app from "./app.js";
import { parseNumber } from "./config.js";

dotenv.config();

const port = parseNumber(process.env.PORT, 3000);
const host = process.env.HOST?.trim() || "0.0.0.0";
const isVercel = process.env.VERCEL === "1";

export default app;

if (!isVercel) {
  app.listen(port, host, () => {
    process.stderr.write(
      `[dcinside-mcp] listening on http://${host}:${port}/mcp (gallery: thesingularity)\n`,
    );
  });
}
