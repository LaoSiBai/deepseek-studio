import { useState } from 'react';
import { useStudio } from '../state/studio';
import { PARAM_DEFS, PARAM_GROUPS, paramVisible, type ParamDef } from '../lib/params';
import { deepseekIssues, isDeepSeekEndpoint } from '../lib/deepseek';
import { parseJson } from '../lib/utils';
import { Icon } from './Icons';
import { NumberInput, Select, TextArea, TextInput, TriState } from './ui';

export function ParamsPanel() {
  const { state, dispatch } = useStudio();
  const params = state.workspace.params;
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const setParam = (key: string, value: string | undefined) => {
    dispatch({ type: 'param', key, value });
  };

  const normalized = query.trim().toLowerCase();
  const matches = (def: ParamDef) =>
    !normalized ||
    def.key.toLowerCase().includes(normalized) ||
    def.label.toLowerCase().includes(normalized);

  const setCount = PARAM_DEFS.filter((def) => Boolean(params[def.key]?.trim())).length;
  const extraInvalid = Boolean(state.workspace.extraBody.trim()) && !parseJson(state.workspace.extraBody).ok;

  const endpoint = state.workspace.endpoint;
  const issues = deepseekIssues(endpoint, params, state.workspace.messages);
  const genericN =
    !isDeepSeekEndpoint(endpoint.baseUrl) &&
    Number(params.n ?? '') > 1 &&
    endpoint.stream;

  return (
    <div className="ds-params">
      <div className="ds-params__bar">
        <div className="ds-search">
          <Icon name="search" size={12} />
          <input
            value={query}
            placeholder="过滤参数名…"
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} title="清除">
              <Icon name="x" size={11} />
            </button>
          )}
        </div>
        <span className={`ds-count ${setCount ? 'is-on' : ''}`}>{setCount} 项已设置</span>
        <button
          type="button"
          className="ds-textbtn"
          onClick={() => dispatch({ type: 'params/reset' })}
          disabled={setCount === 0}
        >
          重置
        </button>
      </div>

      <div className="ds-params__groups">
        {issues.map((issue, index) => (
          <div
            key={`${issue.level}-${index}`}
            className={`ds-inlinewarn ${issue.level === 'block' ? 'is-block' : ''}`}
          >
            <Icon name="alert" size={12} />
            <span>{issue.message}</span>
          </div>
        ))}
        {genericN && (
          <div className="ds-inlinewarn">
            <Icon name="alert" size={12} />
            <span>
              当前 <code>stream</code> 为开，<code>n &gt; 1</code> 时多数端点只会返回第一条候选；
              要看全部候选请关闭 stream 再发送。
            </span>
          </div>
        )}
        {PARAM_GROUPS.map((group) => {
          const defs = PARAM_DEFS.filter(
            (def) => def.group === group.id && paramVisible(def, params) && matches(def),
          );
          if (defs.length === 0) return null;
          const open = normalized ? true : !collapsed[group.id];
          const groupSet = defs.filter((def) => Boolean(params[def.key]?.trim())).length;
          return (
            <section className="ds-group" key={group.id}>
              <button
                type="button"
                className="ds-group__head"
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                }
              >
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
                <span className="ds-group__title">{group.label}</span>
                <span className="ds-group__note">{group.note}</span>
                <span className="ds-spacer" />
                {groupSet > 0 && <span className="ds-count is-on">{groupSet}</span>}
              </button>
              {open && (
                <div className="ds-grid">
                  {defs.map((def) => (
                    <ParamField key={def.key} def={def} value={params[def.key]} onChange={(value) => setParam(def.key, value)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className={`ds-group ds-group--extra ${extraInvalid ? 'is-invalid' : ''}`}>
        <div className="ds-group__head ds-group__head--static">
          <Icon name="fileJson" size={12} />
          <span className="ds-group__title">额外参数</span>
          <span className="ds-group__note">JSON 对象，最后合并，可覆盖任意字段</span>
          <span className="ds-spacer" />
          {state.workspace.extraBody.trim() && (
            <span className={`ds-count ${extraInvalid ? 'is-error' : 'is-on'}`}>
              {extraInvalid ? '无效' : '生效'}
            </span>
          )}
        </div>
        <TextArea
          value={state.workspace.extraBody}
          onChange={(value) => dispatch({ type: 'extra', value })}
          mono
          rows={4}
          invalid={extraInvalid}
          placeholder={'{\n  "top_k": 50,\n  "thinking": { "type": "enabled" }\n}'}
        />
        <p className="ds-hint-block">
          这里适合放面板里没有的参数（新参数、供应商私有字段）。合并规则：对象递归、数组整体替换；层级高于上方表单。
        </p>
      </section>
    </div>
  );
}

function ParamField({
  def,
  value,
  onChange,
}: {
  def: ParamDef;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const parsed = def.kind === 'json' && value?.trim() ? parseJson(value) : null;
  const invalid = Boolean(parsed && !parsed.ok);
  const isSet = Boolean(value?.trim());

  let control;
  switch (def.kind) {
    case 'number':
      control = (
        <NumberInput
          value={value}
          onChange={onChange}
          placeholder={def.placeholder}
          min={def.min}
          max={def.max}
          step={def.step}
        />
      );
      break;
    case 'boolean':
      control = <TriState value={value} onChange={onChange} />;
      break;
    case 'select':
      control = (
        <Select
          value={value ?? ''}
          options={def.options ?? []}
          onChange={(next) => onChange(next === '' ? undefined : next)}
        />
      );
      break;
    case 'text':
      control = (
        <TextInput value={value ?? ''} onChange={(next) => onChange(next || undefined)} placeholder={def.placeholder} />
      );
      break;
    case 'tags':
      control = (
        <TextArea
          value={value ?? ''}
          onChange={(next) => onChange(next || undefined)}
          mono
          rows={2}
          placeholder={def.placeholder}
        />
      );
      break;
    case 'json':
      control = (
        <>
          <TextArea
            value={value ?? ''}
            onChange={(next) => onChange(next || undefined)}
            mono
            rows={3}
            invalid={invalid}
            placeholder={def.placeholder}
          />
          {invalid && parsed && !parsed.ok && <span className="ds-field__error">{parsed.error}</span>}
        </>
      );
      break;
  }

  return (
    <div className={`ds-field ${def.full ? 'is-wide' : ''}`}>
      <div className="ds-field__head">
        <code className="ds-field__label" title={def.hint}>
          {def.label}
        </code>
        {def.hint && (
          <span className="ds-field__hint" title={def.hint}>
            ?
          </span>
        )}
        <span className="ds-spacer" />
        {isSet && (
          <button type="button" className="ds-field__clear" title="取消设置（不发送该字段）" onClick={() => onChange(undefined)}>
            <Icon name="x" size={10} />
          </button>
        )}
      </div>
      {control}
    </div>
  );
}
