import type { Endpoint, Message, ParamValues } from '../types';

export interface DeepSeekIssue {
  level: 'block' | 'warn';
  message: string;
}

/** 只认官方域名；中转站即使路径相同也不套用官方限制 */
export function isDeepSeekEndpoint(baseUrl: string): boolean {
  const value = baseUrl.trim();
  if (!value) return false;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase();
    return host === 'api.deepseek.com' || host.endsWith('.deepseek.com');
  } catch {
    return /(^|\/\/|\.)api\.deepseek\.com/i.test(value);
  }
}

export function isReasonerModel(model: string): boolean {
  return /reasoner/i.test(model);
}

/**
 * DeepSeek 官方接口的能力约束。这里只放已确认会失败或静默无效的规则，
 * 不做客户端拦截——studio 仍然允许把非法请求发出去看服务端怎么回。
 */
export function deepseekIssues(
  endpoint: Endpoint,
  params: ParamValues,
  messages: Message[],
): DeepSeekIssue[] {
  if (!isDeepSeekEndpoint(endpoint.baseUrl)) return [];
  const issues: DeepSeekIssue[] = [];

  const n = params.n?.trim();
  if (n && Number(n) !== 1) {
    issues.push({
      level: 'block',
      message: `DeepSeek 官方接口只接受 n = 1（当前 ${n}），发送会返回 400 Invalid n value。`,
    });
  }

  if (['frequency_penalty', 'presence_penalty'].some((key) => params[key]?.trim())) {
    issues.push({
      level: 'warn',
      message: 'DeepSeek 已废弃 frequency_penalty / presence_penalty，传入不会生效。',
    });
  }

  if (params.response_format === 'json_schema') {
    issues.push({
      level: 'warn',
      message: 'DeepSeek 的 response_format 只支持 text / json_object，json_schema 会被拒绝。',
    });
  }

  const thinkingOff = params.thinking === 'disabled' || params.reasoning_effort === 'none';
  if (!thinkingOff && (params.temperature?.trim() || params.top_p?.trim())) {
    issues.push({
      level: 'warn',
      message:
        '思考模式下 temperature / top_p 不生效（未显式关闭时 DeepSeek 默认开启思考）；要采样控制请设 thinking: disabled 或 reasoning_effort: none。',
    });
  }

  if (['deepseek-chat', 'deepseek-reasoner'].includes(endpoint.model.trim())) {
    issues.push({
      level: 'warn',
      message: `DeepSeek 当前模型是 deepseek-flash / deepseek-v4-pro，${endpoint.model} 可能已下线。`,
    });
  }

  if (isReasonerModel(endpoint.model)) {
    const ignored = [
      ['temperature', 'temperature'],
      ['top_p', 'top_p'],
      ['presence_penalty', 'presence_penalty'],
      ['frequency_penalty', 'frequency_penalty'],
    ]
      .filter(([key]) => params[key]?.trim())
      .map(([, label]) => label);
    if (ignored.length > 0) {
      issues.push({
        level: 'warn',
        message: `deepseek-reasoner 不支持 ${ignored.join('、')}，这些值不会生效。`,
      });
    }
    if (params.logprobs === 'true' || params.top_logprobs?.trim()) {
      issues.push({ level: 'warn', message: 'deepseek-reasoner 不支持 logprobs / top_logprobs。' });
    }
    if (messages.some((message) => message.role === 'assistant' && message.reasoning_content?.trim())) {
      issues.push({
        level: 'warn',
        message: 'deepseek-reasoner 的多轮上下文不能回传 reasoning_content，否则会 400；发送前建议清空。',
      });
    }
  }

  return issues;
}
