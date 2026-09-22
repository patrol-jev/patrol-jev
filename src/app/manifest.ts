import type { MetadataRoute } from "next";

/**
 * 휴대폰 홈 화면에 얹을 때 쓰는 값.
 *
 * 순찰은 밖에서 돈다. 현장에서 사진을 찍고 바로 여는 도구라 주소를 치는 것보다
 * 홈 화면에 아이콘 하나로 두는 편이 빠르다. 그림은 화면의 사진 칸 표식과 같은 것을 쓴다.
 * 도구가 두 얼굴을 가지면 같은 도구인지 알아보지 못한다.
 *
 * 서비스 워커는 두지 않는다. 사진을 캐시에 남기지 않겠다는 약속과 어긋나고,
 * 하루 한 번 쓰는 도구에 오프라인 캐시가 필요하지도 않다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "순찰일지",
    short_name: "순찰일지",
    description: "사진을 올리면 순찰일지 글이 나옵니다.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "ko",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // 홈 화면이 제 모양으로 오려 쓸 수 있게. 바탕이 흰 사각형이라 어떻게 잘려도 그림이 산다.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
