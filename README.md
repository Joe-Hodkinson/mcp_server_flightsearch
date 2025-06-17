
# MCP Flight Server with SerpAPI Integration

> ⚠️ **Note:** This project was developed with the assistance of AI to help me learn and experiment with the **Model Context Protocol (MCP)**.  
> It is a learning and demo project aimed at understanding how to build an MCP-compliant tool server for integration with AI agents, especially Microsoft's **Semantic Kernel** framework.

---

## What is MCP? (Model Context Protocol)

The **Model Context Protocol (MCP)** is an emerging open protocol designed to standardize how AI models (or “agents”) interact with external tools, services, or subprocesses. The goal is to allow large language models (LLMs) and orchestrators to seamlessly communicate with specialized tools by exchanging **JSON-RPC 2.0** messages over standard input/output (stdin/stdout).

The key ideas:

- **JSON-RPC 2.0**: MCP uses this lightweight RPC format with `method`, `params`, `id`, and `jsonrpc` fields.
- **Tool discovery**: The agent can request the list of tools the server supports (`mcp/listTools`).
- **Tool invocation**: The agent can invoke a tool (`mcp/invokeTool`) by name with a JSON payload.
- **Standardized input/output**: All communication happens via JSON messages on stdin/stdout, no HTTP needed.
- **Extensibility**: You can add new tools or methods while adhering to this format.

---

## Why is MCP important for Semantic Kernel?

Microsoft’s **Semantic Kernel** framework uses MCP as its communication contract for calling external “plugins” or “tools.” When you integrate a custom tool server with Semantic Kernel:

- Kernel sends JSON-RPC requests on stdin to your tool server process
- Your server parses the JSON-RPC method and parameters
- Your server performs the requested action (e.g., flight search)
- Your server returns a JSON-RPC response with structured results

This standardization lets you write any tool in any language as long as it follows the MCP spec. Kernel can then **invoke tools dynamically**, reason about their inputs/outputs, and chain them in AI plans or workflows.

---

## How Semantic Kernel expects requests and responses

Semantic Kernel sends requests like:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "mcp/invokeTool",
  "params": {
    "toolName": "getFlightInfo",
    "arguments": {
      "from": "MAN",
      "to": "CDG",
      "date": "2025-08-20"
    }
  }
}
```

- `method`: must be `"mcp/invokeTool"` to call a tool
- `params.toolName`: name of the tool to call (e.g., `"getFlightInfo"`)
- `params.arguments`: JSON object with the tool-specific input parameters

Your server must respond with JSON-RPC 2.0 responses like:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "tool_result",
        "data": "{ "flights": [ ... ] }"
      }
    ],
    "isError": false
  }
}
```

- The `data` field is a JSON-stringified object with the tool’s results.
- The outer wrapper follows the JSON-RPC 2.0 spec strictly.
- If an error occurs, return an error response with appropriate code and message.

---

# MCP Flight Server with SerpAPI Integration

This server is a Node.js tool server that:

- Implements MCP JSON-RPC methods for tool discovery and invocation
- Uses SerpAPI’s Google Flights API to look up flights
- Normalizes and returns flight data formatted for AI consumption
- Handles logging, errors, and input validation robustly

---

## Features

- ✅ Full MCP compliance (`initialize`, `mcp/listTools`, `mcp/invokeTool`)
- 🔑 Secure API key injection via the client
- 🛫 Real-time flight search with SerpAPI
- 📄 Returns normalized flights with pricing, duration, segments, carbon emissions, etc.

---

## Setup Instructions

### Prerequisites

- Node.js 18+
- A valid SerpAPI API key from [https://serpapi.com](https://serpapi.com)
- Git (optional, for cloning repo)

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/mcp-flight-server.git
cd mcp-flight-server
npm install
```

### 🔐 API Key Configuration

This server **requires** the `SERPAPI_KEY` environment variable to access the [SerpAPI Google Flights engine](https://serpapi.com/google-flights-api). However, it does **not** manage authentication itself — the environment or client invoking the server must provide the key.

In most cases, the **MCP client** (e.g. Semantic Kernel) is responsible for setting the environment variable when launching the server. This allows the server to remain **stateless and portable**, with no hardcoded secrets.

🧠 Example: Launch from C# Semantic Kernel MCP Client
You can launch the MCP server directly from C# using Semantic Kernel's McpClientFactory:

```
await using IMcpClient flightsMcpClient = await McpClientFactory.CreateAsync(
    new StdioClientTransport(new()
    {
        Name = "Flights",
        Command = "node",
        Arguments = new[]
        {
            @"C:\path\to\your\mcp-flight-server-node\server.js"
        },
        EnvironmentVariables = new Dictionary<string, string>
        {
            { "SERPAPI_KEY", "YOUR_KEY" } // Pass your SerpAPI key securely here
        },
        // Optional: specify working directory if needed
        // WorkingDirectory = @"C:\path\to\your\mcp-flight-server-node"
    }));
```
---

## Running the Server

```bash
node index.js
```

The server listens on stdin for JSON-RPC requests, and writes JSON-RPC responses on stdout.

---

## Supported Methods and Tools

| Method           | Description                     |
| ---------------- | ------------------------------- |
| `initialize`     | MCP handshake initialization   |
| `mcp/listTools`  | Returns list of supported tools |
| `mcp/invokeTool` | Executes a named tool           |

### Tools

**getFlightInfo**

- Description: Retrieves flight options using SerpAPI Google Flights.
- Input schema:

```json
{
  "type": "object",
  "properties": {
    "from": { "type": "string", "description": "Origin IATA code" },
    "to": { "type": "string", "description": "Destination IATA code" },
    "date": { "type": "string", "format": "date", "description": "Departure date YYYY-MM-DD" }
  },
  "required": ["from", "to", "date"]
}
```

---

## Example JSON-RPC Requests

### Initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize"
}
```

### List Tools

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "mcp/listTools"
}
```

### Invoke Flight Search Tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "mcp/invokeTool",
  "params": {
    "toolName": "getFlightInfo",
    "arguments": {
      "from": "LHR",
      "to": "JFK",
      "date": "2025-07-01"
    }
  }
}
```

---

## Example Response for Flight Search

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "tool_result",
        "data": "{"flights": [{ "price_usd": 500, "total_duration_minutes": 420, "carbon_emissions_grams": 90000, "layovers": ["AMS"], "segments": [{ "airline": "KLM", "flight_number": "KL1084", "from": "LHR", "to": "AMS", "departs": "2025-07-01T06:30", "arrives": "2025-07-01T08:30", "duration_minutes": 120, "airplane": "Boeing 737", "travel_class": "Economy" }]}]}"
      }
    ],
    "isError": false
  }
}
```

---

## Logging

All server operations and errors are logged with timestamps to:

```
C:\Temp\MCPServerLog.log
```

Use this file for debugging and audit trails.

---

## Testing and Debugging Tips

- Use command-line to pipe JSON requests to the server:

```bash
cat test-request.json | node index.js
```

- Use tools like [`jq`](https://stedolan.github.io/jq/) to format JSON outputs.
- Test error scenarios like missing parameters or malformed JSON to confirm robust handling.
- Add verbose logging by inspecting `C:\Temp\MCPServerLog.log`.

---

## Future Enhancements (Roadmap)

- Support for multi-leg and return flights
- Docker containerization for easy deployment
- Caching layer for repeated queries

---


Happy coding and happy flying! 🛫🧠  

