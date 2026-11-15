import { useEffect, useState } from 'react';
import { useStudio } from '../state/studio';
import { generateImages, imageToBlobUrl, type GeneratedImage } from '../lib/imagegen';
import { Icon } from './Icons';
import { toast } from './ui';

const MODELS = ['MiniMax-H3-Image', 'MiniMax-H3-Image-Highspeed'];
const ASPECTS = ['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
const AREAS = ['1K', '2K', '4K'];

interface ImageCache {
  items: GeneratedImage[];
  outputFormat: string;
  prompt: string;
  elapsed: number | null;
}

/** 模块级缓存：切换模式再回来时保留最近一次结果 */
let cache: ImageCache | null = null;

export function ImagePanel() {
  const { state } = useStudio();
  const key = state.workspace.endpoint.apiKey.trim();

  const [baseUrl, setBaseUrl] = useState('https://api.minimaxi.com');
  const [model, setModel] = useState('MiniMax-H3-Image');
  const [prompt, setPrompt] = useState(cache?.prompt ?? '');
  const [aspect, setAspect] = useState('16:9');
  const [area, setArea] = useState('2K');
  const [count, setCount] = useState('1');
  const [responseFormat, setResponseFormat] = useState<'url' | 'b64_json'>('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<GeneratedImage[]>(cache?.items ?? []);
  const [outputFormat, setOutputFormat] = useState(cache?.outputFormat ?? 'jpeg');
  const [elapsed, setElapsed] = useState<number | null>(cache?.elapsed ?? null);

  useEffect(() => {
    cache = { items, outputFormat, prompt, elapsed };
  }, [items, outputFormat, prompt, elapsed]);

  const generate = async () => {
    if (!prompt.trim()) {
      toast('先写一句提示词', 'error');
      return;
    }
    if (!key) {
      toast('先在「连接设置」里填 MiniMax key', 'error');
      return;
    }
    setBusy(true);
    setError('');
    setItems([]);
    setElapsed(null);
    const started = performance.now();
    try {
      const result = await generateImages({
        baseUrl,
        apiKey: key,
        model,
        prompt: prompt.trim(),
        aspectRatio: aspect,
        area,
        n: Number(count),
        responseFormat,
      });
      setItems(result.items);
      setOutputFormat(result.outputFormat);
      setElapsed(performance.now() - started);
      if (result.items.length === 0) setError('接口没有返回图片');
      if (!result.items.some((item) => !item.error)) setError('全部生成失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const download = async (item: GeneratedImage, index: number) => {
    try {
      const href = await imageToBlobUrl(item, outputFormat);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `minimax-${Date.now()}-${index + 1}.${
        outputFormat === 'jpeg' ? 'jpg' : outputFormat
      }`;
      anchor.click();
      if (href.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(href), 2000);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const successCount = items.filter((item) => !item.error).length;
  const srcFor = (item: GeneratedImage) =>
    item.b64 ? `data:image/${outputFormat};base64,${item.b64}` : item.url ?? '';

  return (
    <section className="ds-imagegen">
      <div className="ds-imagegen__form">
        <div className="ds-imagegen__head">
          <span className="ds-imagegen__title">生图</span>
          <span className="ds-muted">MiniMax H3-Image</span>
        </div>

        <label className="ds-imagegen__field">
          <span>提示词</span>
          <textarea
            className="ds-input ds-imagegen__prompt"
            rows={5}
            value={prompt}
            placeholder="一只橘猫趴在窗台晒太阳，暖色午后，胶片质感"
            onChange={(event) => setPrompt(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="ds-imagegen__row">
          <label className="ds-imagegen__field">
            <span>模型</span>
            <select className="ds-select" value={model} onChange={(event) => setModel(event.target.value)}>
              {MODELS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-imagegen__field">
            <span>数量</span>
            <select className="ds-select" value={count} onChange={(event) => setCount(event.target.value)}>
              {['1', '2', '3', '4'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="ds-imagegen__row">
          <label className="ds-imagegen__field">
            <span>宽高比</span>
            <select className="ds-select" value={aspect} onChange={(event) => setAspect(event.target.value)}>
              {ASPECTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-imagegen__field">
            <span>面积</span>
            <select className="ds-select" value={area} onChange={(event) => setArea(event.target.value)}>
              {AREAS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="ds-imagegen__field">
          <span>返回格式</span>
          <select
            className="ds-select"
            value={responseFormat}
            onChange={(event) => setResponseFormat(event.target.value as 'url' | 'b64_json')}
          >
            <option value="url">url（推荐，可逐张下载）</option>
            <option value="b64_json">b64_json（直接内嵌）</option>
          </select>
        </label>

        <label className="ds-imagegen__field">
          <span>端点</span>
          <input
            className="ds-input is-mono"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.minimaxi.com"
            spellCheck={false}
          />
        </label>

        {!key && (
          <div className="ds-inlinewarn">
            <Icon name="alert" size={12} />
            <span>先在「连接设置」里填 MiniMax key；生图不会用到文本端点。</span>
          </div>
        )}

        <button type="button" className="ds-imagegen__go" onClick={() => void generate()} disabled={busy}>
          {busy ? '生成中…' : `生成 ${count} 张`}
        </button>
        <div className="ds-muted ds-imagegen__tip">
          由 MiniMax H3-Image 生成，按张计费；失败项会单独标注。宽高比 + 面积决定输出尺寸。
        </div>
      </div>

      <div className="ds-imagegen__results">
        {error && (
          <div className="ds-errorbox">
            <div className="ds-errorbox__title">生成失败</div>
            <p className="ds-errorbox__message">{error}</p>
          </div>
        )}

        {busy && (
          <div className="ds-imagegen__loading">
            <span className="ds-chat-typing">
              <i />
              <i />
              <i />
            </span>
            <span>正在生成 {count} 张图…</span>
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="ds-imagegen__meta">
              <span>
                {successCount} 张成功 · {items.length - successCount} 张失败
              </span>
              {elapsed !== null && <span>{(elapsed / 1000).toFixed(1)}s</span>}
            </div>
            <div className="ds-imagegen__grid">
              {items.map((item, index) => (
                <figure className="ds-imagegen__card" key={`${item.url ?? item.b64 ?? 'err'}-${index}`}>
                  {item.error ? (
                    <div className="ds-imagegen__failed">{item.error}</div>
                  ) : (
                    <img src={srcFor(item)} alt={`生成结果 ${index + 1}`} loading="lazy" />
                  )}
                  <figcaption>
                    <span className="ds-muted">{item.size ?? (item.error ? '—' : '图片')}</span>
                    <span className="ds-spacer" />
                    {!item.error && (
                      <button type="button" className="ds-textbtn" onClick={() => void download(item, index)}>
                        <Icon name="download" size={11} /> 下载
                      </button>
                    )}
                  </figcaption>
                  {item.revisedPrompt && !item.error && (
                    <details className="ds-imagegen__revised">
                      <summary>实际提示词</summary>
                      <div>{item.revisedPrompt}</div>
                    </details>
                  )}
                </figure>
              ))}
            </div>
          </>
        )}

        {!busy && items.length === 0 && !error && (
          <div className="ds-imagegen__empty">
            <div className="ds-imagegen__empty-title">写一句提示词，生成第一张图</div>
            <p>提示词会被 MiniMax 自动增强；想完全控制可以之后接 disable_prompt_enhanced。</p>
          </div>
        )}
      </div>
    </section>
  );
}
