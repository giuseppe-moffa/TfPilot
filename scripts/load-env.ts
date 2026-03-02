/**
 * Load .env.local and .env before any other imports. Use as first import in CLI scripts
 * so process.env is populated before lib/config/env is evaluated.
 */
try {
  require("dotenv").config({ path: ".env.local" })
  require("dotenv").config()
} catch {
  // dotenv optional
}
