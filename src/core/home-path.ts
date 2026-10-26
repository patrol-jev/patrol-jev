import { homedir } from "node:os";

/**
 * `.env` 값의 `~` 와 `$HOME` 을 집 폴더로 편다.
 *
 * dotenv 는 셸이 아니라 `$HOME` 을 안 편다. 서버 `.env.local` 에 `$HOME/patrol-usage.jsonl` 이라
 * 적혀 있었고, 그 글자 그대로의 폴더(`$HOME/`)가 프로젝트 안에 생기거나 아무 데도 안 적혔다.
 * 사람이 적는 대로 받아 주는 편이 규칙을 하나 더 외우게 하는 것보다 낫다.
 */
export function expandHome(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const home = homedir();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return home + trimmed.slice(1);
  return trimmed.replace(/^\$HOME(?=[/\\]|$)|^\$\{HOME\}(?=[/\\]|$)|^%USERPROFILE%(?=[/\\]|$)/, home);
}
