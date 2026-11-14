import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * 富文本渲染：Markdown + LaTeX。
 *
 * 安全边界：
 * 1. 数学公式先由 katex 渲染成可信 HTML（trust:false，禁用 \href 等危险命令）；
 * 2. 正文交给 marked 后用 DOMPurify 净化；
 * 3. 最后才把占位符替换成公式 HTML —— 顺序反了就等于把未净化的 HTML 注入页面。
 */
const PLACEHOLDER = '\u0001'

function renderMath(token: string, displayMode: boolean): string {
  try {
    return katex.renderToString(token, { displayMode, throwOnError: false, trust: false, strict: false })
  } catch {
    return `<code>${token.replace(/[<>&]/g, '')}</code>`
  }
}

export function renderRichText(source: string): string {
  const formulas: string[] = []
  const masked = source.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (_all, block: string | undefined, inline: string | undefined) => {
    const html = block ? renderMath(block, true) : renderMath(inline ?? '', false)
    formulas.push(html)
    return `${PLACEHOLDER}${formulas.length - 1}${PLACEHOLDER}`
  })

  const raw = marked.parse(masked, { async: false, gfm: true, breaks: true }) as string
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })

  return clean.replace(/\u0001(\d+)\u0001/g, (_all, index: string) => formulas[Number(index)] ?? '')
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderRichText(text), [text])
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
