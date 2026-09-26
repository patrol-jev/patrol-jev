/**
 * 모델을 부르다 실패했을 때 **까닭을 사람 말로**.
 *
 * 「fetch failed」 한 줄로는 담당자가 무엇을 해야 할지 모른다. 인터넷이 끊긴 것인지, 키가 틀린 것인지,
 * 잔액이 다 된 것인지, 서버가 붐비는 것인지에 따라 할 일이 다르다. 그래서 오류를 한 번 걸러
 * 상황과 할 일을 같이 적는다. 짐작이 안 서는 것은 원문을 그대로 붙인다. 숨기지 않는다.
 *
 * 이 파일은 서버에서만 돈다. 키·주소·사진은 여기 오지 않는다.
 */

export type Who = "vision" | "jev";

const NAME: Record<Who, string> = { vision: "사진 읽기(OpenAI)", jev: "판정(Jev)" };

/** 노드 fetch(undici) 가 연결 실패에 붙이는 원인 코드. */
const NETWORK_CODES: Record<string, string> = {
  ENOTFOUND: "주소를 찾지 못했습니다(DNS)",
  ECONNREFUSED: "연결이 거부됐습니다",
  ECONNRESET: "연결이 끊겼습니다",
  ETIMEDOUT: "연결 시간이 지났습니다",
  UND_ERR_CONNECT_TIMEOUT: "연결 시간이 지났습니다",
  UND_ERR_SOCKET: "연결이 끊겼습니다",
  EAI_AGAIN: "주소를 찾지 못했습니다(DNS)",
  CERT_HAS_EXPIRED: "인증서가 만료됐습니다",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "인증서를 확인하지 못했습니다",
};

/** 응답 상태로 보는 까닭. 본문에 quota 같은 낱말이 있으면 그쪽으로 좁힌다. */
export function explainStatus(who: Who, status: number, body = ""): string {
  const name = NAME[who];
  const text = body.toLowerCase();
  if (status === 401) return `${name} 키가 틀렸거나 만료됐습니다. 서버의 키 설정을 확인해 주세요.`;
  if (status === 402) return `${name} 잔액(크레딧)이 다 됐습니다. 충전한 뒤 다시 해 주세요.`;
  if (status === 403) return `${name} 키에 이 모델을 쓸 권한이 없습니다. 키 설정을 확인해 주세요.`;
  if (status === 404) return `${name} 모델 이름을 서버가 모릅니다. 설정(patrol.config.json)의 모델 이름을 확인해 주세요.`;
  if (status === 429) {
    if (/insufficient_quota|billing|credit|balance|exceeded your current quota/.test(text)) {
      return `${name} 잔액(크레딧)이 다 됐습니다. 충전한 뒤 다시 해 주세요.`;
    }
    return `${name} 요청이 몰려 잠시 막혔습니다(분당 한도). 1분쯤 뒤에 다시 해 주세요.`;
  }
  if (status === 400 || status === 422) return `${name} 서버가 요청을 거부했습니다(${status}). 설정의 모델·옵션이 그 모델에 안 맞을 수 있습니다. ${short(body)}`.trim();
  if (status === 529 || status === 503) return `${name} 서버가 붐빕니다(${status}). 잠시 뒤에 다시 해 주세요.`;
  if (status >= 500) return `${name} 서버 쪽 오류입니다(${status}). 잠시 뒤에 다시 해 주세요.`;
  return `${name} 요청이 실패했습니다(${status}). ${short(body)}`.trim();
}

/**
 * 던져진 오류로 보는 까닭. fetch 의 네트워크 오류, SDK 의 APIError(status 있음), 그 밖의 것.
 * 원문은 뒤에 괄호로 남긴다. 담당자가 그대로 옮겨 적어 물어볼 수 있게.
 */
export function explainError(who: Who, error: unknown): string {
  const name = NAME[who];
  if (!(error instanceof Error)) return `${name} 중에 알 수 없는 오류가 났습니다.`;

  const e = error as Error & { status?: unknown; code?: unknown; cause?: unknown; retryAfterMs?: unknown };
  if (typeof e.status === "number") return explainStatus(who, e.status, e.message);

  const code = codeOf(e);
  if (code && NETWORK_CODES[code]) {
    return `${name} 서버에 연결하지 못했습니다. ${NETWORK_CODES[code]}. 이 서버의 인터넷 연결(또는 설정의 주소)을 확인해 주세요. (${code})`;
  }
  if (/fetch failed|network|ECONN|socket|getaddrinfo|APIConnectionError/i.test(e.message) || e.name === "APIConnectionError") {
    return `${name} 서버에 연결하지 못했습니다. 이 서버의 인터넷 연결(또는 설정의 주소)을 확인해 주세요. (${e.message})`;
  }
  if (/timeout|timed out|APITimeoutError/i.test(e.message) || e.name === "APITimeoutError" || e.name === "AbortError") {
    return `${name} 응답이 제때 오지 않았습니다. 서버가 붐비는 시간일 수 있습니다. 잠시 뒤에 다시 해 주세요.`;
  }
  // 우리가 이미 사람 말로 적은 오류는 그대로.
  return e.message;
}

function codeOf(e: Error & { code?: unknown; cause?: unknown }): string | null {
  if (typeof e.code === "string") return e.code;
  const cause = e.cause as { code?: unknown; errors?: Array<{ code?: unknown }> } | undefined;
  if (cause && typeof cause.code === "string") return cause.code;
  const first = cause?.errors?.find((one) => typeof one?.code === "string");
  return first ? (first.code as string) : null;
}

/** 오류 본문은 길다. 화면에 띄울 만큼만. */
function short(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}
