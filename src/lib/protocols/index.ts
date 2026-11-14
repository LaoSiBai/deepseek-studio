import type { ProtocolId } from '../../types';
import { openAIChatProtocol } from './openai';
import { miniMaxChatProtocol } from './minimax';
import { deepSeekResponsesProtocol } from './responses';
import { anthropicMessagesProtocol } from './anthropic';
import type { ProtocolAdapter } from './types';

export const PROTOCOLS: ProtocolAdapter[] = [
  openAIChatProtocol,
  miniMaxChatProtocol,
  deepSeekResponsesProtocol,
  anthropicMessagesProtocol,
];

export function getProtocol(id: ProtocolId | string | undefined): ProtocolAdapter {
  return PROTOCOLS.find((protocol) => protocol.id === id) ?? PROTOCOLS[0];
}

export function protocolLabel(id: ProtocolId | string | undefined): string {
  return getProtocol(id).label;
}

export type {
  BuildOutput,
  ParsedChunk,
  ParsedResponse,
  ProtocolAdapter,
  ProtocolCapabilities,
  StreamParser,
} from './types';
