/**
 * 초과기록 진동 알림용 VAPID 키 한 쌍을 만든다. 서버 환경 변수에 넣는다.
 *
 *   node scripts/make-vapid.mjs
 *
 * 한 번 만들어 계속 쓴다. 바꾸면 이미 알림을 켠 기기는 다시 켜야 한다.
 * 개인키는 서버 밖에 두지 않는다. 레포에 넣지 않는다.
 */

import { createECDH } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY=${ecdh.getPublicKey().toString("base64url")}`);
// 개인키 앞자리가 0 이면 짧게 나온다. JWK 는 32바이트를 원하므로 채운다.
const d = ecdh.getPrivateKey();
const d32 = Buffer.concat([Buffer.alloc(32 - d.length), d]);
console.log(`VAPID_PRIVATE_KEY=${d32.toString("base64url")}`);
