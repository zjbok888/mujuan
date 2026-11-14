import { useEffect, useState } from 'react'
import type { ProviderKind, PublicSettings } from '@shared/settings.js'
import { PROVIDER_PRESETS } from '@shared/settings.js'
import { api } from '../api.js'

interface SettingsResponse {
  settings: PublicSettings
  presets: typeof PROVIDER_PRESETS
}

type ProbeState = { kind: 'idle' | 'busy' | 'ok' | 'fail'; message: string; models?: string[] }

const KINDS: ProviderKind[] = ['deepseek', 'ollama', 'lmstudio', 'custom']

export function SettingsPage() {
  const [loaded, setLoaded] = useState<SettingsResponse | null>(null)
  const [kind, setKind] = useState<ProviderKind>('deepseek')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle', message: '' })
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = (settings: PublicSettings): void => {
    setKind(settings.kind)
    setBaseUrl(settings.baseUrl)
    setModel(settings.model)
    setEnabled(settings.enabled)
    setApiKey('')
  }

  useEffect(() => {
    api
      .get<SettingsResponse>('/api/settings')
      .then((res) => {
        setLoaded(res)
        apply(res.settings)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  const preset = PROVIDER_PRESETS[kind]

  const pick = (next: ProviderKind): void => {
    setKind(next)
    setProbe({ kind: 'idle', message: '' })
    // 换接入方式时带出该方式的预设地址与模型，避免留着上一个服务的配置
    const p = PROVIDER_PRESETS[next]
    if (p.baseUrl) setBaseUrl(p.baseUrl)
    if (p.model) setModel(p.model)
  }

  const probeBody = (): Record<string, unknown> => ({
    kind,
    baseUrl,
    model,
    ...(apiKey.trim() ? { apiKey } : {}),
  })

  const testConnection = async (): Promise<void> => {
    setProbe({ kind: 'busy', message: '正在连接…' })
    try {
      const res = await api.post<{ ok: boolean; message: string; latencyMs?: number; preview?: string }>(
        '/api/settings/test',
        probeBody(),
      )
      setProbe({
        kind: res.ok ? 'ok' : 'fail',
        message: res.ok ? `${res.message}${res.preview ? ` · 模型回复「${res.preview}」` : ''}` : res.message,
      })
    } catch (err) {
      setProbe({ kind: 'fail', message: (err as Error).message })
    }
  }

  const fetchModels = async (): Promise<void> => {
    setProbe({ kind: 'busy', message: '正在拉取模型列表…' })
    try {
      const res = await api.post<{ ok: boolean; models: string[]; message: string }>(
        '/api/settings/models',
        probeBody(),
      )
      setProbe({ kind: res.ok ? 'ok' : 'fail', message: res.message, models: res.models })
      if (res.ok && res.models.length > 0 && !res.models.includes(model)) {
        setModel(res.models[0] ?? model)
      }
    } catch (err) {
      setProbe({ kind: 'fail', message: (err as Error).message })
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveMessage(null)
    try {
      const res = await api.put<{ settings: PublicSettings }>('/api/settings', {
        kind,
        baseUrl,
        model,
        enabled,
        ...(apiKey.trim() ? { apiKey } : {}),
      })
      setLoaded((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      apply(res.settings)
      setSaveMessage(res.settings.demo ? '已保存，但配置不完整，当前仍为演示模式' : '已保存并生效')
      // 通知外层刷新健康状态（顶部的模式角标）
      window.dispatchEvent(new Event('mujuan:settings-changed'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const clearKey = async (): Promise<void> => {
    setSaving(true)
    try {
      const res = await api.put<{ settings: PublicSettings }>('/api/settings', { clearKey: true })
      setLoaded((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      apply(res.settings)
      setSaveMessage('已清除保存的密钥')
      window.dispatchEvent(new Event('mujuan:settings-changed'))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const current = loaded?.settings

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header className="page-head">
        <h1>AI 接入</h1>
        <p>可以连云端 API，也可以连本地模型。密钥只保存在服务端，不会回传到浏览器。</p>
      </header>

      {error && <div className="statusbar err">{error}</div>}

      {current && (
        <div className={`statusbar ${current.demo ? 'warn' : 'ok'}`}>
          <span>
            {current.demo
              ? '当前：演示模式（内置回放，不调用任何模型）'
              : `当前：${PROVIDER_PRESETS[current.kind].label} · ${current.model || '未填模型'}`}
          </span>
          {current.hasKey && <span className="tag">已保存密钥</span>}
        </div>
      )}

      <section className="card panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h2 style={{ marginBottom: 10 }}>选择接入方式</h2>
          <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {KINDS.map((item) => {
              const p = PROVIDER_PRESETS[item]
              const active = kind === item
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => pick(item)}
                  className="card"
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    cursor: 'pointer',
                    borderColor: active ? 'var(--seal)' : 'var(--line)',
                    background: active ? 'var(--seal-soft)' : 'var(--surface)',
                    boxShadow: active ? '0 0 0 2px rgba(178,58,43,.12)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{p.label}</strong>
                    {p.local && <span className="tag">本地</span>}
                    {p.needsKey && <span className="tag warn">需要 Key</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
                    {p.hint}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="divider" />

        <div style={{ display: 'grid', gap: 12 }}>
          <label className="field">
            <span className="label">接口地址（OpenAI 兼容，通常以 /v1 结尾）</span>
            <input
              className="input"
              placeholder="http://127.0.0.1:11434/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
            <label className="field">
              <span className="label">模型</span>
              <input
                className="input"
                placeholder={preset.model || '例如 qwen2.5:7b'}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="model-options"
              />
            </label>
            <button className="btn" onClick={() => void fetchModels()} disabled={probe.kind === 'busy'}>
              拉取模型
            </button>
          </div>

          {probe.models && probe.models.length > 0 && (
            <datalist id="model-options">
              {probe.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}

          <label className="field">
            <span className="label">
              API Key {preset.needsKey ? '（必填）' : '（本地模型通常留空）'}
            </span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder={current?.hasKey ? '已保存，留空则不修改' : 'sk-...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ accentColor: 'var(--seal)' }}
            />
            启用此接入（关闭则回落到演示回放）
          </label>
        </div>

        {(probe.kind === 'ok' || probe.kind === 'fail' || probe.kind === 'busy') && (
          <div className={`statusbar ${probe.kind === 'ok' ? 'ok' : probe.kind === 'fail' ? 'err' : ''}`}>
            <span>{probe.message}</span>
          </div>
        )}

        {saveMessage && <div className="statusbar ok">{saveMessage}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存并启用'}
          </button>
          <button className="btn" onClick={() => void testConnection()} disabled={probe.kind === 'busy'}>
            测试连接
          </button>
          {current?.hasKey && (
            <button className="btn btn-ghost" onClick={() => void clearKey()} disabled={saving}>
              清除已保存的密钥
            </button>
          )}
        </div>

        <p className="muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.7 }}>
          配置保存在 <code>data/settings.json</code>（已被 .gitignore 忽略），优先级高于 <code>.env</code>。
          保存后即刻生效，不需要重启服务。
        </p>
      </section>

      <section className="card panel">
        <h2 style={{ marginBottom: 10 }}>本地模型怎么开</h2>
        <table className="plain">
          <thead>
            <tr>
              <th>方式</th>
              <th>启动命令 / 设置</th>
              <th>默认地址</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Ollama</td>
              <td>
                <code>ollama serve</code> 然后 <code>ollama pull qwen2.5:7b</code>
              </td>
              <td className="mono">http://127.0.0.1:11434/v1</td>
            </tr>
            <tr>
              <td>LM Studio</td>
              <td>加载模型 → Developer → 启动 Local Server</td>
              <td className="mono">http://127.0.0.1:1234/v1</td>
            </tr>
            <tr>
              <td>vLLM / llama.cpp</td>
              <td>启动 OpenAI 兼容 server 后填地址即可</td>
              <td className="mono">http://127.0.0.1:8000/v1</td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.7 }}>
          本地小模型可能不支持 <code>response_format=json_object</code>：服务端会自动降级为"提示词要求 JSON + 本地解析"，
          仍然可用，但建议选 7B 以上的模型，否则题干质量会明显下降。
        </p>
      </section>
    </div>
  )
}
