/**
 * Courier MCP Server
 * Uses Cloudflare's agents framework for proper SSE handling
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { Env, ToolContext } from './types';
import { registerAllTools } from './tools';

export class CourierMCP extends McpAgent {
  server = new McpServer({ 
    name: "Courier", 
    version: "2.0.0" 
  });

  async init() {
    const env = this.env as Env;
    
    const ctx: ToolContext = {
      server: this.server,
      env,
    };

    registerAllTools(ctx);
  }
}
