import { useEffect, useState } from 'react';

export interface EnvInfo {
  hasServerKey: boolean;
  defaultBaseUrl?: string;
  /** 静态部署时没有本地代理，前端直连上游 */
  proxyAvailable: boolean;
}

let cached: EnvInfo | null = null;
let pending: Promise<EnvInfo> | null = null;

function loadEnvInfo(): Promise<EnvInfo> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = fetch('/api/env', { cache: 'no-store' })
      .then(async (response) => {
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error('no proxy');
        }
        const info = (await response.json()) as Omit<EnvInfo, 'proxyAvailable'>;
        return { ...info, proxyAvailable: true };
      })
      .catch((): EnvInfo => ({ hasServerKey: false, proxyAvailable: false }))
      .then((info) => {
        cached = info;
        return info;
      });
  }
  return pending;
}

export function useEnv(): EnvInfo | null {
  const [env, setEnv] = useState<EnvInfo | null>(cached);
  useEffect(() => {
    let alive = true;
    void loadEnvInfo().then((info) => {
      if (alive) setEnv(info);
    });
    return () => {
      alive = false;
    };
  }, []);
  return env;
}
