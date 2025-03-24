# Task Master MCP Server

This module implements a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for Task Master, allowing external applications to access Task Master functionality and context through a standardized API.

## Features

- MCP-compliant server implementation using FastMCP
- RESTful API for context management
- Authentication and authorization for secure access
- Context storage and retrieval with metadata and tagging
- Context windowing and truncation for handling size limits
- Integration with Task Master for task management operations

## Installation

The MCP server is included with Task Master. Install Task Master globally to use the MCP server:

```bash
npm install -g task-master-ai
```

Or use it locally:

```bash
npm install task-master-ai
```

## Environment Configuration

The MCP server can be configured using environment variables or a `.env` file:

| Variable             | Description                              | Default                       |
| -------------------- | ---------------------------------------- | ----------------------------- |
| `MCP_SERVER_PORT`    | Port for the MCP server                  | 3000                          |
| `MCP_SERVER_HOST`    | Host for the MCP server                  | localhost                     |
| `MCP_CONTEXT_DIR`    | Directory for context storage            | ./mcp-server/contexts         |
| `MCP_API_KEYS_FILE`  | File for API key storage                 | ./mcp-server/api-keys.json    |
| `MCP_JWT_SECRET`     | Secret for JWT token generation          | task-master-mcp-server-secret |
| `MCP_JWT_EXPIRATION` | JWT token expiration time                | 24h                           |
| `LOG_LEVEL`          | Logging level (debug, info, warn, error) | info                          |

## Getting Started

### Starting the Server

Start the MCP server as a standalone process:

```bash
npx task-master-mcp-server
```

Or start it programmatically:

```javascript
import { TaskMasterMCPServer } from "task-master-ai/mcp-server";

const server = new TaskMasterMCPServer();
await server.start({ port: 3000, host: "localhost" });
```

### Authentication

The MCP server uses API key authentication with JWT tokens for secure access. A default admin API key is generated on first startup and can be found in the `api-keys.json` file.

To get a JWT token:

```bash
curl -X POST http://localhost:3000/auth/token \
  -H "x-api-key: YOUR_API_KEY"
```

Use the token for subsequent requests:

```bash
curl http://localhost:3000/mcp/tools \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Creating a New API Key

Admin users can create new API keys:

```bash
curl -X POST http://localhost:3000/auth/api-keys \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clientId": "user1", "role": "user"}'
```

## Available MCP Endpoints

The MCP server implements the following MCP-compliant endpoints:

### Context Management

- `GET /mcp/context` - List all contexts
- `POST /mcp/context` - Create a new context
- `GET /mcp/context/{id}` - Get a specific context
- `PUT /mcp/context/{id}` - Update a context
- `DELETE /mcp/context/{id}` - Delete a context

### Models

- `GET /mcp/models` - List available models
- `GET /mcp/models/{id}` - Get model details

### Execution

- `POST /mcp/execute` - Execute an operation with context

## Available MCP Tools

The MCP server provides the following tools:

### Context Tools

- `createContext` - Create a new context
- `getContext` - Retrieve a context by ID
- `updateContext` - Update an existing context
- `deleteContext` - Delete a context
- `listContexts` - List available contexts
- `addTags` - Add tags to a context
- `truncateContext` - Truncate a context to a maximum size

### Task Master Tools

- `listTasks` - List tasks from Task Master
- `getTaskDetails` - Get detailed task information
- `executeWithContext` - Execute operations using context

## Examples

### Creating a Context

```javascript
// Using the MCP client
const client = new MCPClient("http://localhost:3000");
await client.authenticate("YOUR_API_KEY");

const context = await client.createContext("my-context", {
  title: "My Project",
  tasks: ["Implement feature X", "Fix bug Y"],
});
```

### Executing an Operation with Context

```javascript
// Using the MCP client
const result = await client.execute("generateTask", "my-context", {
  title: "New Task",
  description: "Create a new task based on context",
});
```

## Integration with Other Tools

The Task Master MCP server can be integrated with other MCP-compatible tools and clients:

- LLM applications that support the MCP protocol
- Task management systems that support context-aware operations
- Development environments with MCP integration

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
