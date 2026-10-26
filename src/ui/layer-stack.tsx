"use client";

import { useEffect, useRef } from "react";

/**
 * 사진 칸 안의 세 겹.
 *
 * 이 도구가 하는 일은 겹 셋이다. 맨 위가 **사진**, 가운데가 **판정**(Jev), 맨 아래가 **일지 글**.
 * 밑의 세 칸(1·2·3)이 글로 하는 말을 칸 안에서 그림으로 한 번 더 한다.
 * 겹은 가만히 숨 쉬듯 뜨고, 손(마우스)을 따라 조금 기운다.
 * 사진을 끌어 오거나 읽는 동안에는 겹이 벌어지고, 사진 한 장이 위에서 아래로 겹을 지나 내려간다.
 *
 * 색 규칙은 그대로다. **무지개는 가운데 겹(Jev 의 자리)에만** 쓴다. 나머지는 무채색이다.
 * 사진 칸 표식(주황 사진기)은 이 그림 위에 따로 얹는다.
 *
 * 입체를 못 그리면 아무것도 안 그린다. 칸은 원래대로 표식 하나로 남는다.
 * 움직임 줄이기를 켠 기기에서는 멈춘 그림 한 장이다.
 *
 * `sheet` 를 켜면 맨 아래 겹이 일지 글 대신 **표**(엑셀 대장)다. `accent` 는 겹을 지나는 사진 한 장의 색.
 * `plain` 을 켜면 모델 없는 도구(사진일지)의 겹이다. 가운데가 판정 대신 **사진 표**(두 줄 격자와 설명 띠),
 * 맨 아래가 **문서**(제목 상자와 □ 소제목)이고 무지개를 쓰지 않는다.
 */
export function LayerStack({
  active,
  onShot,
  sheet = false,
  plain = false,
  accent = 0xf9871f,
}: {
  active: boolean;
  onShot?: () => void;
  sheet?: boolean;
  plain?: boolean;
  accent?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  // 사진 한 장이 사진기에서 떠나는 순간. 사진기 표식이 그때 「찰칵」 한다.
  const shotRef = useRef(onShot);

  useEffect(() => {
    activeRef.current = active;
    shotRef.current = onShot;
  }, [active, onShot]);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | null = null;

    (async () => {
      const THREE = await import("three");
      const box = host.current;
      if (!alive || !box) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.display = "block";
      box.appendChild(renderer.domElement);

      const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const dark = window.matchMedia("(prefers-color-scheme: dark)");

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      camera.position.set(6, 6.4, 6);
      camera.lookAt(0, -0.2, 0);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.6);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(3, 8, 2);
      scene.add(sun);

      // 화면 색은 CSS 값에서 읽는다. 밝은 화면·어두운 화면 둘 다 같은 규칙으로.
      const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

      const W = 3.4;
      const D = 2.3;

      const canvasTexture = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = Math.round((512 * D) / W);
        draw(canvas.getContext("2d")!, canvas.width, canvas.height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        return texture;
      };

      const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
      };

      /** 겹 세 장의 윗면 그림. 색이 바뀌면(밝음↔어두움) 다시 그린다. */
      const faces = () => {
        const paper = css("--paper") || "#ffffff";
        const line = css("--line") || "#e7e6e2";
        const gen = css("--gen") || "#b6b5af";
        const genStrong = css("--gen-strong") || "#6f6e69";
        const jev = [css("--jev-1"), css("--jev-2"), css("--jev-3"), css("--jev-4")].map((c, i) => c || ["#7c5cff", "#22d3ee", "#a3e635", "#ffb4a2"][i]);

        // 사진: 작은 사진 열두 장(하늘과 땅이 갈린 무채색 네모).
        const photo = canvasTexture((ctx, w, h) => {
          ctx.fillStyle = paper;
          ctx.fillRect(0, 0, w, h);
          const cols = 4;
          const rows = 3;
          const gap = 14;
          const tw = (w - gap * (cols + 1)) / cols;
          const th = (h - gap * (rows + 1)) / rows;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const x = gap + c * (tw + gap);
              const y = gap + r * (th + gap);
              roundRect(ctx, x, y, tw, th, 8);
              ctx.fillStyle = line;
              ctx.fill();
              ctx.save();
              ctx.clip();
              ctx.fillStyle = gen;
              ctx.globalAlpha = 0.55;
              ctx.fillRect(x, y + th * (0.55 + 0.1 * ((r + c) % 2)), tw, th);
              ctx.globalAlpha = 1;
              ctx.restore();
            }
          }
        });

        // 판정: 네 갈래 칸. 테두리와 칸이 Jev 무지개다(이 겹만).
        // 모델 없는 도구에서는 사진 표: 두 칸씩 세 줄, 칸마다 사진과 아래 설명 띠. 무채색.
        const judge = canvasTexture((ctx, w, h) => {
          ctx.fillStyle = paper;
          ctx.fillRect(0, 0, w, h);
          if (plain) {
            const x0 = 26;
            const y0 = 20;
            const tw = w - 52;
            const th = h - 40;
            const cw = tw / 2;
            const rh = th / 3;
            ctx.strokeStyle = genStrong;
            ctx.lineWidth = 3;
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 2; c++) {
                const x = x0 + c * cw;
                const y = y0 + r * rh;
                ctx.fillStyle = gen;
                ctx.globalAlpha = 0.5;
                ctx.fillRect(x + 8, y + 7, cw - 16, rh * 0.62);
                ctx.globalAlpha = 1;
                roundRect(ctx, x + cw * 0.3, y + rh * 0.76, cw * 0.4, 8, 4);
                ctx.fillStyle = genStrong;
                ctx.fill();
              }
            }
            ctx.strokeRect(x0, y0, tw, th);
            ctx.beginPath();
            ctx.moveTo(x0 + cw, y0);
            ctx.lineTo(x0 + cw, y0 + th);
            for (let r = 1; r < 3; r++) {
              ctx.moveTo(x0, y0 + r * rh);
              ctx.lineTo(x0 + tw, y0 + r * rh);
            }
            ctx.stroke();
            return;
          }
          const gradient = ctx.createLinearGradient(0, 0, w, h);
          gradient.addColorStop(0, jev[0]);
          gradient.addColorStop(0.36, jev[1]);
          gradient.addColorStop(0.68, jev[2]);
          gradient.addColorStop(1, jev[3]);
          ctx.lineWidth = 14;
          ctx.strokeStyle = gradient;
          roundRect(ctx, 7, 7, w - 14, h - 14, 22);
          ctx.stroke();
          const gap = 26;
          const cw = (w - gap * 5) / 4;
          for (let i = 0; i < 4; i++) {
            roundRect(ctx, gap + i * (cw + gap), h * 0.3, cw, h * 0.4, 12);
            ctx.fillStyle = jev[i];
            ctx.globalAlpha = 0.85;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        });

        // 일지 글: 회색 줄들. 표를 그릴 때는 머리줄이 짙은 칸 격자.
        const text = canvasTexture((ctx, w, h) => {
          ctx.fillStyle = paper;
          ctx.fillRect(0, 0, w, h);
          if (plain) {
            // 문서: 가운데 제목 상자, □ 소제목, 그 밑 줄 몇.
            ctx.strokeStyle = genStrong;
            ctx.lineWidth = 4;
            roundRect(ctx, w * 0.22, 22, w * 0.56, 46, 6);
            ctx.stroke();
            roundRect(ctx, w * 0.32, 39, w * 0.36, 12, 6);
            ctx.fillStyle = genStrong;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeRect(32, 96, 16, 16);
            roundRect(ctx, 58, 98, w * 0.32, 12, 6);
            ctx.fill();
            [0.86, 0.7, 0.8, 0.56].forEach((len, i) => {
              roundRect(ctx, 32, 138 + i * 40, (w - 64) * len, 11, 6);
              ctx.fillStyle = gen;
              ctx.fill();
            });
            return;
          }
          if (sheet) {
            const cols = [0.16, 0.2, 0.3, 0.12, 0.22];
            const rows = 6;
            const x0 = 26;
            const y0 = 22;
            const tw = w - 52;
            const rh = (h - 44) / rows;
            ctx.fillStyle = genStrong;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(x0, y0, tw, rh);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = gen;
            ctx.lineWidth = 3;
            ctx.strokeRect(x0, y0, tw, rh * rows);
            for (let r = 1; r < rows; r++) {
              ctx.beginPath();
              ctx.moveTo(x0, y0 + r * rh);
              ctx.lineTo(x0 + tw, y0 + r * rh);
              ctx.stroke();
            }
            let cx = x0;
            for (const part of cols.slice(0, -1)) {
              cx += tw * part;
              ctx.beginPath();
              ctx.moveTo(cx, y0);
              ctx.lineTo(cx, y0 + rh * rows);
              ctx.stroke();
            }
            return;
          }
          const lines = [0.8, 0.62, 0.74, 0.5, 0.7, 0.58];
          lines.forEach((len, i) => {
            roundRect(ctx, 30, 26 + i * ((h - 52) / lines.length), (w - 60) * len, 12, 6);
            ctx.fillStyle = i === 0 ? genStrong : gen;
            ctx.fill();
          });
        });

        return { photo, judge, text, line };
      };

      const plateGeometry = new THREE.BoxGeometry(W, 0.07, D);
      const edgeGeometry = new THREE.EdgesGeometry(plateGeometry);
      const layers: {
        group: import("three").Group;
        top: import("three").MeshStandardMaterial;
        side: import("three").MeshStandardMaterial;
        edge: import("three").LineBasicMaterial;
        rest: number;
      }[] = [];

      const stack = new THREE.Group();
      scene.add(stack);

      const REST = [1.25, 0, -1.25];
      for (let i = 0; i < 3; i++) {
        const top = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
        const side = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true, opacity: 0.9 });
        // 상자 여섯 면 가운데 윗면(2번)에만 그림을 붙인다.
        const plate = new THREE.Mesh(plateGeometry, [side, side, top, side, side, side]);
        const edge = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
        const group = new THREE.Group();
        group.add(plate, new THREE.LineSegments(edgeGeometry, edge));
        group.position.y = REST[i];
        stack.add(group);
        layers.push({ group, top, side, edge, rest: REST[i] });
      }

      // 겹을 지나 내려가는 사진 한 장.
      const cardMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 });
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.46), cardMaterial);
      card.visible = false;
      stack.add(card);

      let current: ReturnType<typeof faces> | null = null;
      const paintFaces = () => {
        current?.photo.dispose();
        current?.judge.dispose();
        current?.text.dispose();
        current = faces();
        const paper = new THREE.Color(css("--paper") || "#ffffff");
        const lineColor = new THREE.Color(current.line);
        const maps = [current.photo, current.judge, current.text];
        layers.forEach((layer, i) => {
          layer.top.map = maps[i];
          layer.top.needsUpdate = true;
          layer.side.color = paper.clone().lerp(lineColor, 0.6);
          layer.edge.color = lineColor.clone().multiplyScalar(dark.matches ? 1.6 : 0.85);
        });
      };
      paintFaces();
      dark.addEventListener("change", paintFaces);

      const resize = () => {
        const w = box.clientWidth;
        const h = box.clientHeight;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = `${w}px`;
        renderer.domElement.style.height = `${h}px`;
        // 칸 높이에 맞춰 겹 셋이 다 들어오게. 넓은 칸이면 가운데에 작게 앉는다.
        const span = 3.1;
        const aspect = w / Math.max(h, 1);
        camera.left = -span * aspect;
        camera.right = span * aspect;
        camera.top = span;
        camera.bottom = -span;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(box);
      resize();

      // 손을 따라 기운다. 칸 밖으로 나가면 제자리로.
      const tilt = { x: 0, y: 0 };
      const want = { x: 0, y: 0 };
      const onMove = (event: PointerEvent) => {
        const rect = box.getBoundingClientRect();
        want.y = ((event.clientX - rect.left) / rect.width - 0.5) * 0.5;
        want.x = ((event.clientY - rect.top) / rect.height - 0.5) * 0.18;
      };
      const onLeave = () => {
        want.x = 0;
        want.y = 0;
      };
      const zone = box.parentElement ?? box;
      zone.addEventListener("pointermove", onMove);
      zone.addEventListener("pointerleave", onLeave);

      // 안 보일 때는 돌리지 않는다.
      let seen = true;
      const watcher = new IntersectionObserver(([entry]) => {
        seen = entry.isIntersecting;
      });
      watcher.observe(box);

      let spread = 0;
      let frame = 0;
      let cardT = 0;
      const started = performance.now();
      let last = started;

      const draw = (now: number) => {
        const time = (now - started) / 1000;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const on = activeRef.current;

        spread += ((on ? 1 : 0) - spread) * Math.min(1, dt * 4);
        tilt.x += (want.x - tilt.x) * Math.min(1, dt * 5);
        tilt.y += (want.y - tilt.y) * Math.min(1, dt * 5);

        stack.rotation.y = tilt.y + Math.sin(time * 0.25) * 0.06;
        stack.rotation.x = tilt.x;

        layers.forEach((layer, i) => {
          const breathe = Math.sin(time * 1.1 + i * 1.2) * 0.07;
          layer.group.position.y = layer.rest * (1 + spread * 0.45) + breathe;
          layer.group.rotation.y = Math.sin(time * 0.6 + i) * 0.015;
        });

        // 사진 한 장이 맨 위에서 맨 아래까지. 끌어 오거나 읽는 동안, 그리고 가끔 저절로.
        const idleTurn = time % 7 < 2.4;
        if (on || idleTurn || cardT > 0) {
          if (cardT === 0 || cardT === 0.0001) shotRef.current?.();
          cardT += dt / (on ? 1.6 : 2.4);
          if (cardT >= 1) cardT = on ? 0.0001 : 0;
          const topY = layers[0].group.position.y + 1.1;
          const bottomY = layers[2].group.position.y + 0.05;
          const e = cardT < 0.5 ? 2 * cardT * cardT : 1 - Math.pow(-2 * cardT + 2, 2) / 2;
          card.visible = cardT > 0;
          card.position.set(Math.sin(cardT * Math.PI) * 0.35, topY + (bottomY - topY) * e, 0);
          card.rotation.y = cardT * Math.PI;
        } else card.visible = false;

        renderer.render(scene, camera);
      };

      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        if (!seen || document.hidden) return;
        draw(now);
      };
      // 첫 장면은 무조건 한 번 그린다. 창이 가려진 채 열려도 칸이 비어 보이지 않게.
      draw(performance.now());
      if (!quiet) frame = requestAnimationFrame(tick);

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        watcher.disconnect();
        dark.removeEventListener("change", paintFaces);
        zone.removeEventListener("pointermove", onMove);
        zone.removeEventListener("pointerleave", onLeave);
        current?.photo.dispose();
        current?.judge.dispose();
        current?.text.dispose();
        plateGeometry.dispose();
        edgeGeometry.dispose();
        card.geometry.dispose();
        cardMaterial.dispose();
        for (const layer of layers) {
          layer.top.dispose();
          layer.side.dispose();
          layer.edge.dispose();
        }
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
  }, [sheet, plain, accent]);

  return <div ref={host} aria-hidden className="pointer-events-none absolute inset-0" />;
}
