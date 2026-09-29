/**
 * Fast, language-neutral token estimator:
 * ~1.5 chars per token for CJK scripts, ~4 chars per token for Latin, Cyrillic, Greek, Arabic, etc.
 */
export class TokenEstimator {
  public static estimate(text: string): number {
    let cjkCount = 0;
    let otherCount = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fff) {
        cjkCount++;
      } else {
        otherCount++;
      }
    }
    return Math.ceil(cjkCount / 1.5 + otherCount / 4);
  }
}
