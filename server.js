// === MCP Flight Server with SerpAPI Integration ===
// This Node.js server listens for JSON-RPC requests via stdin (standard input),
// calls the SerpAPI (Google Flights engine) to retrieve real flight data,
// and returns structured JSON-RPC responses to stdout (standard output).
// Designed for integration into AI agent frameworks using the Model Context Protocol (MCP).
// Includes verbose logging, validation, and safety features for robust use in real applications.

import readline from "readline";  // Reads incoming lines (one-by-one) from stdin.
import fs from "fs";              // Node.js filesystem module, used for writing logs.
import path from "path";          // For safely working with file paths (cross-platform).
import dotenv from "dotenv";      // Loads secrets like API keys from a .env file.

dotenv.config();  // Loads the environment variables into process.env

// === Global Error Handlers ===
// These ensure that even unhandled async exceptions are logged clearly.
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err.stack || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED PROMISE REJECTION:", reason);
});

// Log whether the SERPAPI_KEY was loaded successfully (but don’t print the key itself)
console.error("SERPAPI_KEY from environment:", process.env.SERPAPI_KEY ? "[SET]" : "[MISSING]");

// === stdin/stdout interface ===
// This allows the server to work as a subprocess that communicates using the JSON-RPC protocol.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,  // Prevents readline from treating stdin like a TTY
});

console.error("MCP Flight Server starting with SerpAPI integration...");

// === Validate Environment ===
const API_KEY = process.env.SERPAPI_KEY;
if (!API_KEY) {
  console.error("FATAL: Missing SERPAPI_KEY in environment.");
  process.exit(1);
}

// === Log File Setup ===
const logDir = "C:\\Temp";
const logPath = path.join(logDir, "MCPServerLog.log");

// Centralized logger that writes timestamped entries to file
function log(type, message, data = null) {
  try {
    fs.mkdirSync(logDir, { recursive: true });  // Make sure log dir exists
    const line = `[${new Date().toISOString()}] [${type}] ${message}${data ? ": " + JSON.stringify(data, null, 2) : ""}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  } catch (err) {
    console.error(`Logging failure: ${err.message}`);
  }
}

// === Helper: Write a JSON-RPC response to stdout ===
function sendResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// === Core: Query SerpAPI for flight data ===
async function lookupFlights(from, to, date) {
  const url = `https://serpapi.com/search?engine=google_flights&departure_id=${encodeURIComponent(from)}&arrival_id=${encodeURIComponent(to)}&outbound_date=${encodeURIComponent(date)}&type=2&api_key=${API_KEY}`;

  log("INFO", "Flight search URL", { url });

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} - ${res.statusText}`);
    }

    const json = await res.json();

    const bestFlights = Array.isArray(json.best_flights) ? json.best_flights : [];
    const otherFlights = Array.isArray(json.other_flights) ? json.other_flights : [];
    const allFlightsRaw = bestFlights.concat(otherFlights);

    if (allFlightsRaw.length === 0) {
      log("WARN", "No flights returned from API", { from, to, date });
      return [];
    }

    // === Normalize results for AI use ===
    // Flatten into a simple, structured format suitable for agent reasoning.
    const results = allFlightsRaw.map((flight) => {
      const legs = flight.flights.map((leg) => ({
        airline: leg.airline,
        flight_number: leg.flight_number,
        from: leg.departure_airport.name,
        to: leg.arrival_airport.name,
        departs: leg.departure_airport.time,
        arrives: leg.arrival_airport.time,
        duration_minutes: leg.duration,
        airplane: leg.airplane,
        travel_class: leg.travel_class,
        extensions: leg.extensions,
      }));

      return {
        price_usd: flight.price,
        total_duration_minutes: flight.total_duration,
        carbon_emissions_grams: flight.carbon_emissions?.this_flight,
        layovers: flight.layovers || [],
        segments: legs,
      };
    });

    log("INFO", "Flight results", results);
    return results;
  } catch (err) {
    log("ERROR", "Flight API fetch failed", { error: err.message });
    throw new Error(`Flight lookup failed: ${err.message}`);
  }
}

// === Handle stdin closed (e.g. client shutdown) ===
rl.on("close", () => {
  console.error("Stdin closed — shutting down.");
  process.exit(0);
});

// === Main Request Handler ===
// This fires on every incoming line from stdin (one JSON-RPC request per line)
rl.on("line", async (line) => {
  if (!line.trim()) return;

  let req;
  try {
    req = JSON.parse(line);
  } catch (parseErr) {
    return sendResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error: Invalid JSON" },
    });
  }

  const id = req.id ?? null;

  // Basic JSON-RPC structure check
  if (req.jsonrpc !== "2.0" || !req.method) {
    return sendResponse({
      jsonrpc: "2.0",
      id,
      error: { code: -32600, message: "Invalid Request" },
    });
  }

  // === Handle Supported JSON-RPC Methods ===
  switch (req.method) {
    case "initialize":
      // Standard MCP handshake
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "SerpAPI Flight Server", version: "1.0.0" },
        },
      });
      break;

    case "mcp/listTools":
    case "tools/list":
      // Return a list of available tools
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "getFlightInfo",
              description: "Retrieve flight options via SerpAPI Google Flights",
              inputSchema: {
                type: "object",
                properties: {
                  from: { type: "string", description: "Origin IATA code" },
                  to: { type: "string", description: "Destination IATA code" },
                  date: { type: "string", format: "date", description: "Date (YYYY-MM-DD)" },
                },
                required: ["from", "to", "date"],
              },
            },
          ],
        },
      });
      break;

    case "mcp/invokeTool":
    case "tools/call":
    case "invokeTool": {
      // Tool invocation request
      const params = req.params || {};
      const toolName = params.toolName || params.name;
      const args = params.arguments || {};

      if (toolName !== "getFlightInfo") {
        return sendResponse({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
      }

      // === Validate input parameters ===
      const { from, to, date } = args;
      const missing = ["from", "to", "date"].filter((k) => !(k in args));
      if (missing.length) {
        return sendResponse({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: `Missing required parameter(s): ${missing.join(", ")} in tool 'getFlightInfo'. Expected format: { from: "IATA", to: "IATA", date: "YYYY-MM-DD" }`,
          },
        });
      }

      try {
        const results = await lookupFlights(from, to, date);

        // Wrap results in MCP tool_result format
        sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "tool_result",
                data: JSON.stringify({ flights: results }),
              },
            ],
            isError: false,
          },
        });
      } catch (err) {
        sendResponse({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "tool_result",
                data: JSON.stringify({ error: err.message }),
              },
            ],
            isError: true,
          },
        });
      }
      break;
    }

    default:
      // Unsupported method
      sendResponse({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
  }
});
