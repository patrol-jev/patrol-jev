import { loadConfig, readEyeKeys, readKey, toClientConfig } from "@/core/config";
import { EYE_NAME, whichEye } from "@/core/eyes";
import PatrolApp from "./app";

// 설정과 키는 빌드할 때가 아니라 **띄울 때** 읽는다.
// 그래야 patrol.config.json 을 고치고 다시 띄우면 바로 반영된다.
export const dynamic = "force-dynamic";

export default function Page() {
  const config = loadConfig();
  // 사진을 읽을 눈. 키가 있는 쪽이고, 둘 다 있으면 설정이 먼저를 정한다. 화면에는 이름만 내려간다.
  const eye = whichEye(config, readEyeKeys());

  return (
    <PatrolApp
      config={toClientConfig(config)}
      ready={{
        vision: eye !== null,
        eye: eye ? EYE_NAME[eye] : null,
        firstPass: Boolean(readKey("TYPESAFE_API_KEY")) && config.firstPass.enabled,
      }}
    />
  );
}
