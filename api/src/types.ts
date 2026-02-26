/**
 * Courier Type Definitions
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Environment bindings from Cloudflare
export interface Env {
  DB: D1Database;
  ADMIN_API_KEY: string;
  RESEND_API_KEY: string;
  KV?: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
}

// Context passed to tool registration functions
export interface ToolContext {
  server: McpServer;
  env: Env;
}

// D1 Database types (Cloudflare)
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  error?: string;
  meta: {
    last_row_id: number;
    changes: number;
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}
