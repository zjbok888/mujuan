/**
 * 答案归一化 —— 判分可复现的一半在此。
 *
 * 学生在填空里写 "x＝1"、"x = 1"、"X=1." 都应判对，
 * 但 "x=1" 与 "x=2" 必须判错。归一化只做"等价书写"的消除，不做语义猜测。
 */

const FULLWIDTH_OFFSET = 0xfee0

function toHalfWidth(ch: string): string {
  const code = ch.charCodeAt(0)
  // 全角 ！(FF01) ~ ～(FF5E) 平移到 ASCII
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - FULLWIDTH_OFFSET)
  if (code === 0x3000) return ' ' // 全角空格
  return ch
}

export function normalizeAnswer(raw: string): string {
  return raw
    .normalize('NFKC')
    .split('')
    .map(toHalfWidth)
    .join('')
    .replace(/\s+/g, '')
    .replace(/[。.；;，,、]+$/g, '')
    .replace(/[−–—]/g, '-')
    .toLowerCase()
}

/** 数字题容差比较；非数字则退化为字符串比较 */
export function answersEqual(input: string, expected: string): boolean {
  const a = normalizeAnswer(input)
  const b = normalizeAnswer(expected)
  if (a.length === 0 || b.length === 0) return false
  if (a === b) return true

  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    return Math.abs(na - nb) <= 1e-6 * Math.max(1, Math.abs(nb))
  }
  return false
}

/** 简答题关键词命中：模糊包含，但要求关键词本身非空 */
export function containsKeyword(text: string, keyword: string): boolean {
  const hay = normalizeAnswer(text)
  const needle = normalizeAnswer(keyword)
  if (!needle) return false
  return hay.includes(needle)
}
