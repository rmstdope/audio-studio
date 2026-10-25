/** What a language code may look like: a language, then optional region or script parts. */
const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** Whether `code` is a language code the studio can name (`en`, `sv`, `pt-BR`). */
export function knownLanguage(code: string): boolean {
  if (!CODE.test(code)) return false
  try {
    return (
      new Intl.DisplayNames([code], { type: 'language', fallback: 'none' }).of(code) !== undefined
    )
  } catch {
    return false
  }
}

/** A language named in itself, first letter upper-cased: `sv` → `Svenska`, `de` → `Deutsch`. */
export function languageName(code: string): string {
  const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
}
