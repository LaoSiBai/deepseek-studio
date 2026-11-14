import type { ProtocolId, ToolCall, Usage, Workspace } from '../../types';

export interface ParsedResponse {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  finishReason: string | null;
}

export interface ParsedChunk {
  contentDelta?: string;
  reasoningDelta?: string;
  /** 完整工具调用快照，由协议 parser 内部维护 */
  toolCalls?: ToolCall[];
  usage?: Usage;
  finishReason?: string | null;
  /** 兜底正文（例如 MiniMax 末帧的完整 message），仅当累计正文为空时使用 */
  finalContent?: string;
  error?: string;
}

export interface StreamParser {
  push(json: unknown, eventName?: string): ParsedChunk;
  finish(): ParsedChunk;
}

export interface ProtocolCapabilities {
  temperature: { min: number; max: number; hint?: string };
  supportsMaxTokens: boolean;
  supportsJsonSchema: boolean;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsFiles: boolean;
  supportsServerTools: boolean;
  supportsSafety: boolean;
  supportsTitle: boolean;
  supportsUsageDetails: boolean;
  toolChoiceValues: string[];
}

export interface BuildOutput {
  body: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export interface ProtocolAdapter {
  id: ProtocolId;
  label: string;
  defaultPath: string;
  capabilities: ProtocolCapabilities;
  buildBody(workspace: Workspace): BuildOutput;
  readResponse(json: unknown): ParsedResponse | null;
  createStreamParser(): StreamParser;
  readBusinessError(json: unknown): string | null;
}

export interface StreamState {
  toolCalls: ToolCall[];
  usage: Usage | null;
  finishReason: string | null;
}
