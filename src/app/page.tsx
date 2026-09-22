import { loadConfig, readKey, toClientConfig } from "@/core/config";
import PatrolApp from "./app";

// 설정과 키는 빌드할 때가 아니라 **띄울 때** 읽는다.
// 그래야 patrol.config.json 을 고치고 다시 띄우면 바로 반영된다.
export const dynamic = "force-dynamic";

export default function Page() {
  const config = loadConfig();

  return (
    <PatrolApp
      config={toClientConfig(config)}
      ready={{
        vision: Boolean(readKey("OPENAI_API_KEY")),
        firstPass: Boolean(readKey("TYPESAFE_API_KEY")) && config.firstPass.enabled,
      }}
    />
  );
}
