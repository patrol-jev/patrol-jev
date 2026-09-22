"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ClientConfig } from "@/core/config";
import { buildGroups, decideLane } from "@/core/group";
import { LANES, type Lane, type LaneOrUnknown } from "@/core/lanes";
import {
  allPhrases,
  defaultPhrases,
  laneOfPhrase,
  manualGroups,
  splitManual,
  type Phrase,
} from "@/core/manual";
import { buildReport, DEFAULT_WORDING, learnWording, type Wording } from "@/core/report";
import {
  commonDate,
  countBackwards,
  minutesBetween,
  readStamp,
  stampFromClock,
  type ShotStamp,
} from "@/core/shot-time";
import type { Described, FirstPassInput, Group, Judged } from "@/core/types";
import { GroupCard } from "@/ui/group-card";
import { ManualCard } from "@/ui/manual-card";
import { Meter, Tracks } from "@/ui/jev";
import {
  countHeic,
  IMAGE_ACCEPT,
  isImageFile,
  preparePhotos,
  type FailedPhoto,
  type Prepared,
  type PreparedPhoto,
} from "@/ui/photo";
import { DayCalendar, PastDay } from "@/ui/days";
import { DongPicker, type DongChoice } from "@/ui/dong";
import { ReportView } from "@/ui/report-view";
import {
  appendRun,
  baselineAsked,
  forgetWording,
  keepPassFromUrl,
  learnedPhrases,
  learnLane,
  learnWork,
  learnWordingLocal,
  readBaseline,
  readDays,
  readDong,
  readLearned,
  readRuns,
  readWorks,
  readWording,
  recallLane,
  recallWork,
  saveDay,
  summarise,
  writeBaseline,
  writeDong,
} from "@/ui/usage";

type Stage = "home" | "field" | "report";
type Phase = "idle" | "prepare" | "describe" | "judge" | "done";
/**
 * 어느 길로 만드는가.
 *   auto   = 사진을 모델이 읽는다(키가 있고 한도가 남았을 때).
 *   manual = 모델을 한 번도 안 부르고 사람이 자리와 말을 적는다. 비용 0, 사진은 안 나간다.
 */
type Mode = "auto" | "manual";

export default function PatrolApp({
  config,
  ready,
}: {
  config: ClientConfig;
  ready: { vision: boolean; firstPass: boolean };
}) {
  const [stage, setStage] = useState<Stage>("home");
  const [phase, setPhase] = useState<Phase>("idle");
  /**
   * **이번 회차를 어느 길로 만들었나.** 화면에 무엇을 그릴지는 이 값이 정한다.
   *
   * 들어가는 길(`mode`)과 따로 둔다. 한도를 다 쓰는 순간 들어가는 길은 수동으로 바뀌는데,
   * 그때 화면까지 같이 바뀌면 **방금 모델이 읽어 낸 자리**가 수동 칸으로 그려진다.
   */
  const [madeBy, setMadeBy] = useState<Mode | null>(null);
  /** 수동 모드에서 무엇으로 묶었는지. 화면에 그대로 적는다. */
  const [groupedBy, setGroupedBy] = useState<"time" | "count" | null>(null);
  /** 무엇으로 줄 세웠는지. 차례가 곧 묶기라 이것도 화면에 적는다. */
  const [orderedBy, setOrderedBy] = useState<"time" | "given" | null>(null);
  /** 고른 동의 도로명. 수동 모드의 주소 칸이 이걸로 자동완성된다. */
  const [roads, setRoads] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 오류는 아니지만 사람이 알아야 하는 것. 차례가 어긋났다든지. */
  const [notice, setNotice] = useState<string | null>(null);

  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [described, setDescribed] = useState<Record<number, Described>>({});
  const [judged, setJudged] = useState<Record<number, Judged>>({});
  const [groups, setGroups] = useState<Group[]>([]);

  const [wall, setWall] = useState({ gen: 0, jev: 0 });
  /** 도는 동안 숫자가 같이 올라가게. 끝나면 wall 의 잰 값으로 바뀐다. */
  const [elapsed, setElapsed] = useState({ gen: 0, jev: 0 });
  const [edits, setEdits] = useState(0);
  const [copied, setCopied] = useState(false);
  const [firstPassName, setFirstPassName] = useState(config.firstPass.model);
  /**
   * 담당자가 고른 동. 주소를 이 동의 도로명으로 대조한다.
   * undefined = 이번에 고른 적 없음 → 브라우저에 기억된 값을 쓴다.
   */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  /** 달력에서 고른 지난 날짜. 고르면 그날 일지를 본다. */
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  /** 달력은 접혀 있는 것이 기본이다. 날마다 쓰는 화면에서 자리를 먼저 차지하면 안 된다. */
  const [calendarOpen, setCalendarOpen] = useState(false);
  /** 맛보기 한도. limit 0 이면 한도가 없다(로컬에 받아 쓰는 경우). */
  const [quota, setQuota] = useState<{ limit: number; left: number | null }>({ limit: 0, left: null });
  const pass = useRef<string | null>(null);

  /**
   * 사진 읽기를 지금 쓸 수 있나 — 키가 있고 오늘 몫이 남아 있어야 한다.
   * 이 값을 상태로 복사해 두지 않는다. 두 벌이 되면 반드시 어긋난다.
   */
  const canRead = ready.vision && !(quota.limit > 0 && quota.left === 0);
  /**
   * 지금 들어가는 길. 고르는 칸을 따로 두지 않는다 —
   * 사진을 읽을 수 있으면 읽고, 키가 없거나 오늘 몫을 다 썼으면 직접 적는다.
   */
  const mode: Mode = canRead ? "auto" : "manual";
  /** 사람이 고친 일지 글. 고치지 않았으면 null. */
  const [editedReport, setEditedReport] = useState<string | null>(null);
  /** 문구를 배우거나 지울 때마다 올린다. localStorage 가 바뀐 것을 리액트는 모른다. */
  const [wordingVersion, setWordingVersion] = useState(0);

  // localStorage 는 서버에 없다. 렌더 안에서 바로 읽되, 브라우저에 붙은 뒤에만 읽는다.
  const mounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const [logVersion, setLogVersion] = useState(0);
  const [baselineDone, setBaselineDone] = useState(false);
  const logged = useRef(false);

  // logVersion 이 바뀌면 다시 렌더되고, 그때 다시 읽는다. 값이 작아 memo 할 것도 없다.
  void logVersion;
  const runs = mounted ? readRuns().length : 0;
  // 지난 날짜들. 한 회차가 끝날 때마다 다시 읽는다.
  const days = useMemo(() => {
    // 회차가 끝날 때마다 다시 읽는다. localStorage 가 바뀐 것을 리액트는 모른다.
    void logVersion;
    return mounted ? readDays() : [];
  }, [mounted, logVersion]);
  const pastRecord = pickedDay ? (days.find((day) => day.date === pickedDay) ?? null) : null;

  // 사람이 고쳐 둔 문구. 없으면 기본 문구.
  const wording = useMemo(() => {
    void wordingVersion;
    return mounted ? readWording() : {};
  }, [mounted, wordingVersion]);

  // 고른 동. 이번에 고르지 않았으면 브라우저에 기억된 값(서버 렌더 때는 없음).
  const dong = picked !== undefined ? picked : mounted ? readDong() : null;
  // 「○○구_○○동」에서 동 이름만. 일지 머리글에 그대로 찍힌다.
  const dongLabel = dong ? (dong.split("_")[1] ?? null) : null;
  const askBaseline = mounted && !baselineDone && !baselineAsked();

  const photoByIndex = useMemo(
    () => Object.fromEntries(photos.map((photo) => [photo.index, photo])),
    [photos],
  );
  const date = useMemo(
    // 날짜는 많이 나온 쪽으로. 한 장이 잘못 읽혀도 일지 날짜가 끌려가지 않게.
    () => commonDate(photos.map((photo) => photo.date)) || today(),
    [photos],
  );

  const report = useMemo(
    () =>
      buildReport({
        // 담당자가 고른 동이 곧 일지 머리글의 동이다. 안 골랐으면 설정값.
        dong: dongLabel ?? config.dong,
        date,
        groups,
        seasonalSpots: config.seasonalSpots,
        wording,
      }),
    [config.dong, config.seasonalSpots, date, dongLabel, groups, wording],
  );

  // 지금까지 써 본 자리 문구. 고를 수 있게 카드에 내려보낸다.
  const phrases = useMemo(() => {
    void logVersion;
    return mounted ? readWorks().phrases : [];
  }, [mounted, logVersion]);

  /**
   * 수동 모드에서 고를 수 있는 말과 그 란.
   *
   * 기본 셋(란마다 하나)이 먼저 오고, 그 뒤에 지금까지 써 본 말이 붙는다.
   * **말을 고르면 란이 따라온다** — 그래야 사람이 채울 칸이 자리와 말 둘로 끝난다.
   */
  const manualPhrases: Phrase[] = useMemo(() => {
    void logVersion;
    const learned = mounted ? learnedPhrases(readWorks()) : [];
    return allPhrases(
      wording,
      // 란을 모르는 말은 목록에만 남기고 란은 순찰사항으로 둔다. 고르면 사람이 고칠 수 있다.
      learned.map((one) => ({
        text: one.text,
        lane: (one.lane in LANES ? one.lane : "waste_cleanup") as Lane,
      })),
    );
  }, [mounted, logVersion, wording]);

  /** 새 자리의 기본 갈래 = 기본 문구의 란. 둘이 어긋나면 일지가 엉뚱한 란으로 간다. */
  const manualLane: Lane = defaultPhrases(wording)[0].lane;

  // 고른 동의 도로명. 주소를 손으로 칠 때 세 자만 쳐도 나오게 한다.
  useEffect(() => {
    let alive = true;
    const asked: Promise<string[]> = dong
      ? fetch(`/api/roads?dong=${encodeURIComponent(dong)}`)
          .then((response) => (response.ok ? response.json() : { roads: [] }))
          .then((body: { roads?: string[] }) => (Array.isArray(body.roads) ? body.roads : []))
          .catch(() => [])
      : Promise.resolve([]);

    asked.then((list) => {
      if (alive) setRoads(list);
    });
    return () => {
      alive = false;
    };
  }, [dong]);

  /** 화면에 보이고 복사되고 저장되는 글. 사람이 고쳤으면 고친 글이다. */
  const reportText = editedReport ?? report.full;

  /** 알릴 말을 덮지 않고 잇는다. 한 회차에 알릴 것이 둘 이상일 수 있다. */
  const addNotice = useCallback((line: string) => {
    setNotice((current) => (current ? `${current} ${line}` : line));
  }, []);

  const refreshQuota = useCallback(() => {
    fetch("/api/quota", { headers: passHeader(pass.current) })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { limit?: number; left?: number | null } | null) => {
        if (body) setQuota({ limit: body.limit ?? 0, left: body.left ?? null });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // 주소에 열쇠가 달려 있으면 기억하고 주소창을 깨끗이 한다.
    pass.current = keepPassFromUrl();
    refreshQuota();
  }, [refreshQuota]);

  // 도는 동안 0.1초마다 「지금까지 몇 초」를 고쳐 적는다. 장별 시간의 합이 아니라 실제 시간이다.
  useEffect(() => {
    if (phase !== "describe" && phase !== "judge") return;

    const key = phase === "describe" ? "gen" : "jev";
    const base = phase === "describe" ? wall.gen : wall.jev;
    const from = performance.now();

    const timer = setInterval(() => {
      setElapsed((current) => ({ ...current, [key]: base + (performance.now() - from) }));
    }, 100);
    return () => clearInterval(timer);
  }, [phase, wall.gen, wall.jev]);

  /**
   * 수동 모드 — **모델을 한 번도 부르지 않는다.**
   *
   * 사진은 브라우저에서 줄이기만 하고 서버로 보내지 않는다(base64 도 안 만든다).
   * 코드가 사진에서 가져오는 것은 EXIF 시각 하나뿐이고, 그걸로 자리를 묶는다.
   * 주소와 말은 사람이 적는다 — 묶기·시각·문장·학습은 자동 모드와 똑같은 코드가 한다.
   */
  const runManual = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setNotice(null);
      setEditedReport(null);
      setStage("field");
      setPhase("prepare");
      logged.current = false;

      setMadeBy("manual");
      if (countHeic(files) > 0) addNotice(HEIC_NOTE);

      let opened: Prepared;
      try {
        // 네 번째 인자 false = 서버로 보낼 base64 를 안 만든다. 보낼 데가 없다.
        opened = await preparePhotos(files, config.vision.maxEdge, photos.length, false);
      } catch (cause) {
        setPhase("idle");
        setError(cause instanceof Error ? cause.message : "사진을 열지 못했습니다.");
        return;
      }
      if (opened.failed.length > 0) addNotice(failedNote(opened.failed));
      if (opened.photos.length === 0) {
        setPhase("idle");
        setError("올리신 사진을 한 장도 열지 못했습니다.");
        return;
      }
      setOrderedBy(opened.ordered);
      const prepared = opened.photos;
      setPhotos((current) => [...current, ...prepared]);

      const { groups: made, by } = manualGroups(
        prepared.map((photo) => ({
          index: photo.index,
          stamp: stampFromClock(photo.date, photo.time),
        })),
        {
          groupSize: config.manual.groupSize,
          sameMinutes: config.thresholds.sameMinutes,
          lane: manualLane,
        },
      );

      setGroupedBy(by);
      // 이미 적어 둔 자리는 건드리지 않는다. 새로 넣은 사진만 뒤에 붙인다 —
      // 통째로 다시 묶으면 사람이 친 주소가 날아간다.
      setGroups((current) => [...current, ...made]);
      setPhase("done");
    },
    [addNotice, config, manualLane, photos.length],
  );

  /** 사진이 들어오면 (A) 사진→글 → (B) 글→판정 → (C) 묶기 까지 한 번에 흐른다. */
  const run = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setNotice(null);
      setEditedReport(null);

      // 맛보기 자리에서는 남은 만큼만 받는다. 30장을 올렸다가 10장에서 멈추는 것이 제일 나쁘다.
      let taking = files;
      if (quota.limit > 0 && quota.left !== null) {
        if (quota.left <= 0) {
          // 그 자리에서 수동으로 이어 간다. 묶기·시각·문장은 그대로 나온다.
          await runManual(files);
          addNotice(
            `맛보기는 하루 ${quota.limit}장까지라 오늘은 다 읽었습니다. ` +
              "사진 읽기만 빼고 직접 적는 길로 이어 갑니다 — 묶기와 일지 글은 그대로 나옵니다. " +
              "받아서 본인 키로 쓰시면 장수 제한이 없습니다.",
          );
          return;
        }
        if (files.length > quota.left) {
          taking = files.slice(0, quota.left);
          addNotice(
            `맛보기는 하루 ${quota.limit}장까지라 앞의 ${taking.length}장만 읽습니다. ` +
              "받아서 본인 키로 쓰시면 장수 제한이 없습니다.",
          );
        }
      }
      setStage("field");
      setPhase("prepare");
      logged.current = false;

      setMadeBy("auto");
      if (countHeic(taking) > 0) addNotice(HEIC_NOTE);

      let opened: Prepared;
      try {
        opened = await preparePhotos(taking, config.vision.maxEdge, photos.length);
      } catch (cause) {
        setPhase("idle");
        setError(cause instanceof Error ? cause.message : "사진을 열지 못했습니다.");
        return;
      }
      // 한 장이 안 열려도 나머지는 간다. 서른 장 가운데 한 장 때문에 그날 일지를 못 쓰면 안 된다.
      if (opened.failed.length > 0) addNotice(failedNote(opened.failed));
      if (opened.photos.length === 0) {
        setPhase("idle");
        setError("올리신 사진을 한 장도 열지 못했습니다.");
        return;
      }
      setOrderedBy(opened.ordered);

      const prepared = opened.photos;
      const all = [...photos, ...prepared];
      setPhotos(all);

      // ── (A) 사진 → 글. 느린 쪽. 한 장씩 돌아오는 대로 화면에 꽂는다.
      setPhase("describe");
      const genStarted = performance.now();
      const fresh: Record<number, Described> = {};
      try {
        await pool(prepared, config.vision.concurrency, async (photo) => {
          const result = await post<{ described: Described[] }>(
            "/api/describe",
            { photos: [{ index: photo.index, data: photo.data, mediaType: photo.mediaType }], dong },
            pass.current,
          );
          for (const item of result.described) {
            fresh[item.index] = item;
            setDescribed((previous) => ({ ...previous, [item.index]: item }));
          }
        });
      } catch (cause) {
        setPhase("idle");
        setError(cause instanceof Error ? cause.message : "사진을 읽지 못했습니다.");
        return;
      }
      const genMs = performance.now() - genStarted;

      // ── (B) 글 → 판정. 빠른 쪽. 앞 장이 있어야 「같은 자리인가」를 물을 수 있다.
      setPhase("judge");
      const jevStarted = performance.now();
      const everything = { ...described, ...fresh };
      // 찍힌 시각은 EXIF 가 먼저다. 없으면 사진에 찍힌 워터마크를 코드가 읽는다 —
      // 메신저로 오간 사진은 EXIF 가 벗겨져 오고, 그럴 때 시각은 화면 글자에만 남는다.
      const stamps: Record<number, ShotStamp | null> = {};
      for (const photo of all) {
        stamps[photo.index] =
          stampFromClock(photo.date, photo.time) ?? readStamp(everything[photo.index]?.textInPhoto);
      }

      // 되찾은 시각은 사진에 되돌려 적는다. 묶음 카드의 시각과 일지 머리글의 날짜가 이걸 쓴다.
      const timed = all.map((photo) => {
        const stamp = stamps[photo.index];
        if (!stamp || (photo.date && photo.time)) return photo;
        return { ...photo, date: photo.date || stamp.date, time: photo.time || stamp.time };
      });
      setPhotos(timed);

      // 묶기는 「찍은 차례 = 순찰 동선」을 전제로 돈다. 그 전제가 깨졌으면 말해 준다.
      const backwards = countBackwards(all.map((photo) => stamps[photo.index]));
      if (backwards > 0) {
        addNotice(
          `사진 ${backwards}군데가 찍힌 시각과 거꾸로 올라왔습니다. ` +
            `묶기는 올라온 차례대로 합니다. 찍은 차례대로 다시 올리면 더 잘 묶입니다.`,
        );
      }

      const inputs: FirstPassInput[] = prepared.map((photo) => {
        const position = all.findIndex((item) => item.index === photo.index);
        const before = position > 0 ? all[position - 1] : null;
        const beforeText = before ? everything[before.index] : undefined;
        const mine = everything[photo.index];
        return {
          index: photo.index,
          caption: mine?.caption ?? "",
          textInPhoto: mine?.textInPhoto ?? null,
          signText: mine?.signText ?? null,
          previous:
            before && beforeText
              ? {
                  index: before.index,
                  caption: beforeText.caption,
                  minutesApart: minutesBetween(stamps[before.index], stamps[photo.index]),
                }
              : null,
        };
      });

      const nextJudged: Record<number, Judged> = { ...judged };
      try {
        await pool(inputs, config.firstPass.concurrency, async (item) => {
          const result = await post<{ judged: Judged[]; firstPass: string }>("/api/judge", {
            items: [item],
          });
          setFirstPassName(result.firstPass);
          for (const one of result.judged) {
            nextJudged[one.index] = one;
            setJudged((previous) => ({ ...previous, [one.index]: one }));
          }
        });
      } catch (cause) {
        setPhase("idle");
        setError(cause instanceof Error ? cause.message : "판정하지 못했습니다.");
        return;
      }
      const jevMs = performance.now() - jevStarted;

      // ── (C) 묶기. 여기부터는 모델이 아니라 코드다.
      // 지난번에 사람이 정해 준 자리는 그대로 따른다. 갈래가 안 선 자리에만 얹는다 —
      // 기계가 분명히 본 것을 옛 기억으로 덮지는 않는다.
      const learned = readLearned();
      const works = readWorks();
      setGroups(
        applyLearned(
          buildGroups(
            all.map((photo) => everything[photo.index]).filter(Boolean),
            Object.values(nextJudged),
            config.thresholds,
            stamps,
            config.manual.groupSize,
          ),
          learned,
          works,
        ),
      );
      setWall((previous) => ({ gen: previous.gen + genMs, jev: previous.jev + jevMs }));
      setPhase("done");
      refreshQuota();
    },
    [addNotice, config, described, dong, judged, photos, quota, refreshQuota, runManual],
  );

  /** 사진을 받는 자리는 하나다. 어느 길로 갈지는 여기서 갈린다. */
  const take = useCallback(
    (files: File[]) => {
      void (mode === "manual" ? runManual(files) : run(files));
    },
    [mode, run, runManual],
  );

  // 한 회차가 끝나면 로그를 한 줄 남긴다. 브라우저 안에만 쌓이고 아무 데도 안 간다.
  useEffect(() => {
    if (phase !== "done" || logged.current || groups.length === 0) return;
    logged.current = true;
    const list = Object.values(judged);
    appendRun(
      {
        at: new Date().toISOString(),
        mode,
        photos: photos.length,
        groups: groups.length,
        visionMs: Math.round(wall.gen),
        visionCalls: Object.keys(described).length,
        visionInputTokens: sum(Object.values(described).map((d) => d.inputTokens)),
        visionOutputTokens: sum(Object.values(described).map((d) => d.outputTokens)),
        firstPassMs: Math.round(wall.jev),
        firstPassCalls: list.length,
        firstPassInputTokens: sum(list.map((j) => j.inputTokens)),
        unknownLanes: groups.filter((group) => group.lane === "unknown").length,
        manualEdits: edits,
        copied,
        baselineMinutes: readBaseline(),
      },
      config.log.mode,
    );
    // 그날 일지도 같이 남긴다. 사진은 담지 않는다. 달력에서 다시 꺼내 볼 수 있게.
    if (config.log.mode !== "off") {
      saveDay({
        date,
        savedAt: new Date().toISOString(),
        photos: photos.length,
        groups: groups.length,
        report: reportText,
        dong: dongLabel ?? config.dong,
      });
    }
    setLogVersion((n) => n + 1);
  }, [
    phase,
    groups,
    judged,
    described,
    photos.length,
    wall,
    edits,
    copied,
    config.log.mode,
    config.dong,
    date,
    dongLabel,
    mode,
    report,
    reportText,
  ]);

  // ── 사람이 고치는 자리 ────────────────────────────────

  const touch = (id: string, change: (group: Group) => Group) => {
    setEdits((n) => n + 1);
    setGroups((current) =>
      current.map((g) => {
        if (g.id !== id) return g;
        const next = { ...change(g), edited: true, learned: false };
        // 주소가 있는 자리에서 갈래를 고쳤으면 그 자리를 기억해 둔다. 다음에 같은 자리면 그대로 둔다.
        if (next.address.trim() && next.lane !== g.lane) learnLane(next.address, next.lane);
        return next;
      }),
    );
  };

  const mergeUp = (id: string) => {
    setEdits((n) => n + 1);
    setGroups((current) => {
      const at = current.findIndex((g) => g.id === id);
      if (at <= 0) return current;
      const previous = current[at - 1];
      const merged: Group = {
        ...previous,
        photos: [...previous.photos, ...current[at].photos],
        address: previous.address || current[at].address,
        edited: true,
      };
      const next = [...current];
      next.splice(at - 1, 2, merged);
      return next;
    });
  };

  const splitAt = (id: string, photoIndex: number) => {
    setEdits((n) => n + 1);
    setGroups((current) => {
      const at = current.findIndex((g) => g.id === id);
      if (at < 0) return current;
      const group = current[at];
      const cut = group.photos.indexOf(photoIndex);
      if (cut <= 0) return current;

      if (mode === "manual") {
        const stamps = Object.fromEntries(
          photos.map((photo) => [photo.index, stampFromClock(photo.date, photo.time)]),
        );
        const halves = splitManual(group, photoIndex, stamps);
        if (halves.length < 2) return current;
        const next = [...current];
        next.splice(at, 1, ...halves);
        return next;
      }

      const byIndex = new Map(Object.values(judged).map((j) => [j.index, j]));
      const head = group.photos.slice(0, cut);
      const tail = group.photos.slice(cut);
      const make = (photos: number[], suffix: string): Group => ({
        id: `${group.id}${suffix}`,
        photos,
        address: "",
        lane: decideLane(photos, byIndex, config.thresholds),
        edited: true,
        time: photos.map((i) => photoByIndex[i]?.time).filter(Boolean).sort()[0] ?? "",
      });

      const next = [...current];
      next.splice(at, 1, make(head, "a"), make(tail, "b"));
      return next;
    });
  };

  // ── 화면 ────────────────────────────────────────────

  const busy = phase === "prepare" || phase === "describe" || phase === "judge";
  // 도는 동안은 흐르는 시계, 끝난 뒤에는 잰 값.
  const genElapsed = phase === "describe" ? elapsed.gen : wall.gen;
  const jevElapsed = phase === "judge" ? elapsed.jev : wall.jev;

  const genTimes = photos.map((p) => described[p.index]?.ms).filter((v): v is number => v != null);
  const jevTimes = photos.map((p) => judged[p.index]?.ms).filter((v): v is number => v != null);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <Header
        stage={stage}
        setStage={setStage}
        dong={config.dong}
        unit={config.unit}
        ready={ready}
        mode={madeBy ?? mode}
        runs={runs}
      />

      {(error ?? notice) && (
        <p
          className="rounded-lg px-3 py-2 text-[12px]"
          style={{ background: "var(--wash)", color: "var(--ink)" }}
        >
          {error ?? notice}
        </p>
      )}

      {askBaseline && (
        <Baseline
          onDone={(minutes) => {
            writeBaseline(minutes);
            setBaselineDone(true);
          }}
        />
      )}

      {stage === "home" && (
        <Home
          onFiles={take}
          busy={busy}
          ready={ready}
          quota={quota}
          mode={mode}
          quotaSpent={quota.limit > 0 && quota.left === 0}
          dong={dong}
          onDong={(name) => {
            setPicked(name);
            writeDong(name);
          }}
        />
      )}

      {stage !== "home" && (
        <section className="rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
          <button
            onClick={() => setCalendarOpen((open) => !open)}
            className="flex w-full items-center gap-2 text-left text-[12px]"
          >
            <span>지난 기록</span>
            {days.length > 0 && (
              <span className="tnum text-[11px] text-[var(--muted)]">{days.length}일</span>
            )}
            <span className="ml-auto text-[11px] text-[var(--muted)]">
              {calendarOpen ? "접기" : "열기"}
            </span>
          </button>

          {calendarOpen && (
            <div className="mt-3">
              <DayCalendar days={days} picked={pickedDay} onPick={setPickedDay} />
            </div>
          )}
        </section>
      )}

      {pastRecord && (
        <PastDay
          record={pastRecord}
          onCopy={() => {
            navigator.clipboard?.writeText(pastRecord.report).catch(() => undefined);
          }}
        />
      )}

      {stage !== "home" && !pickedDay && photos.length > 0 && (
        <>
          {madeBy === "manual" ? (
            <section className="space-y-1.5 rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
              <p className="text-[12px]">
                <b>직접 적기</b> · 생성 모델 없이 작동합니다.
              </p>
              <p className="tnum text-[11px] text-[var(--muted)]">
                사진 {photos.length}장 → 자리 {groups.length}곳
                {groupedBy === "time" && " · 찍힌 시각으로 묶었습니다"}
                {groupedBy === "count" &&
                  ` · 찍힌 시각이 없어 ${config.manual.groupSize}장씩 끊었습니다`}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                묶기와 일지 글은 자동일 때와 같은 코드가 만듭니다.
              </p>
              {busy && <p className="text-[11px] text-[var(--muted)]">사진을 줄이는 중…</p>}
            </section>
          ) : (
          <section className="space-y-3 rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
            <Tracks gen={genTimes} jev={jevTimes} genMs={genElapsed} jevMs={jevElapsed} />
            <Meter
              judgments={jevTimes.length}
              jevMs={jevElapsed}
              jevInput={sum(Object.values(judged).map((j) => j.inputTokens))}
              genMs={genElapsed}
              genInput={sum(Object.values(described).map((d) => d.inputTokens))}
              genOutput={sum(Object.values(described).map((d) => d.outputTokens))}
              genModel="OpenAI"
              jevModel={firstPassName}
            />
            {busy && (
              <p className="text-[11px] text-[var(--muted)]">
                {phase === "prepare" && "사진을 줄이는 중…"}
                {phase === "describe" &&
                  `사진 → 글  ${genTimes.length}/${photos.length}`}
                {phase === "judge" && `글 → 판정  ${jevTimes.length}/${photos.length}`}
              </p>
            )}
          </section>
          )}

          {stage === "field" && orderedBy && (
            <p className="text-[11px] text-[var(--muted)]">
              {orderedBy === "time"
                ? "사진에 찍힌 시각이 다 있어 그 차례로 줄 세웠습니다."
                : "찍힌 시각을 모르는 사진이 있어 올라온 차례 그대로 두었습니다. 자리가 어긋나 보이면 합치거나 나눠 주세요."}
            </p>
          )}

          {stage === "field" && madeBy === "manual" && (
            <section className="space-y-3">
              {/* 고른 동의 도로명. 카드마다 200개씩 그리지 않으려고 한 번만 둔다. */}
              <datalist id="patrol-roads">
                {roads.map((road) => (
                  <option key={road} value={road} />
                ))}
              </datalist>

              {groups.map((group, order) => (
                <ManualCard
                  key={group.id}
                  group={group}
                  order={order + 1}
                  photos={group.photos.map((i) => photoByIndex[i]).filter(Boolean)}
                  isFirst={order === 0}
                  phrases={manualPhrases}
                  defaultWork={defaultWorkOf(group.lane, { ...DEFAULT_WORDING, ...wording })}
                  onAddress={(address) =>
                    touch(group.id, (g) => {
                      const next = { ...g, address };
                      // 지난번에 이 자리에 적어 둔 말이 있으면 얹는다. **비어 있을 때만** —
                      // 사람이 방금 친 말을 옛 기억으로 덮지 않는다.
                      if (!g.work?.trim() && address.replace(/s+/g, "").length >= 6) {
                        const remembered = recallWork(address, readWorks());
                        if (remembered) {
                          next.work = remembered;
                          const lane = laneOfPhrase(remembered, manualPhrases);
                          if (lane) next.lane = lane;
                        }
                      }
                      return next;
                    })
                  }
                  onWork={(work, lane) => {
                    touch(group.id, (g) => ({ ...g, work, ...(lane ? { lane } : {}) }));
                    if (group.address.trim()) learnWork(group.address, work, lane ?? group.lane);
                  }}
                  onLane={(lane: LaneOrUnknown) => touch(group.id, (g) => ({ ...g, lane }))}
                  onMergeUp={() => mergeUp(group.id)}
                  onSplitAt={(photoIndex) => splitAt(group.id, photoIndex)}
                />
              ))}
              <AddMore onFiles={take} busy={busy} />
            </section>
          )}

          {stage === "field" && madeBy !== "manual" && (
            <section className="space-y-3">
              {groups.map((group, order) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  order={order + 1}
                  photos={group.photos.map((i) => photoByIndex[i]).filter(Boolean)}
                  judged={judged}
                  described={described}
                  thresholds={config.thresholds}
                  isFirst={order === 0}
                  onLane={(lane: LaneOrUnknown) => touch(group.id, (g) => ({ ...g, lane }))}
                  onAddress={(address) => touch(group.id, (g) => ({ ...g, address }))}
                  onWork={(work) => {
                    touch(group.id, (g) => ({ ...g, work }));
                    // 그 자리에 적을 말을 기억한다. 다음에 같은 자리면 그대로 얹는다.
                    if (group.address.trim()) learnWork(group.address, work);
                  }}
                  phrases={phrases}
                  defaultWork={defaultWorkOf(group.lane, { ...DEFAULT_WORDING, ...wording })}
                  onMergeUp={() => mergeUp(group.id)}
                  onSplitAt={(photoIndex) => splitAt(group.id, photoIndex)}
                />
              ))}
              <AddMore onFiles={take} busy={busy} />
            </section>
          )}

          {stage === "report" && (
            <>
              <ReportView
                report={report}
                text={reportText}
                edited={editedReport !== null || Object.keys(wording).length > 0}
                onCopy={() => setCopied(true)}
                onEdit={(next) => {
                  // 고친 글에서 문구만 배운다. 틀이 달라졌으면 그 회차에만 남는다.
                  learnWordingLocal(learnWording(report.full, next, { ...DEFAULT_WORDING, ...wording }));
                  setWordingVersion((n) => n + 1);
                  setEditedReport(next);
                  setEdits((n) => n + 1);
                }}
                onReset={() => {
                  forgetWording();
                  setWordingVersion((n) => n + 1);
                  setEditedReport(null);
                }}
              />
              <AddMore onFiles={take} busy={busy} />
            </>
          )}
        </>
      )}

      <Footer runs={runs} />
    </div>
  );
}

// ── 조각들 ────────────────────────────────────────────

function Header({
  stage,
  setStage,
  dong,
  unit,
  ready,
  mode,
  runs,
}: {
  stage: Stage;
  setStage: (stage: Stage) => void;
  dong: string;
  unit: string;
  ready: { vision: boolean; firstPass: boolean };
  mode: Mode;
  runs: number;
}) {
  const tabs: Array<[Stage, string]> = [
    ["home", "홈"],
    ["field", "현장"],
    ["report", "보고서"],
  ];

  return (
    <header className="flex flex-wrap items-center gap-3">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight">
          {unit} <span className="text-[var(--muted)]">· {dong}</span>
        </h1>
        <p className="text-[11px] text-[var(--muted)]">
          사진을 올리면 순찰일지 글이 나옵니다.
        </p>
      </div>

      <nav className="ml-auto flex gap-1 rounded-lg p-0.5" style={{ background: "var(--wash)" }}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStage(key)}
            className="rounded-md px-3 py-1.5 text-[12px]"
            style={
              stage === key
                ? { background: "var(--paper)", color: "var(--ink)", fontWeight: 500 }
                : { color: "var(--muted)" }
            }
          >
            {label}
          </button>
        ))}
      </nav>

      {/* 쓰지도 않은 모델에 불을 켜 두지 않는다. 직접 적기에서는 둘 다 안 부른다. */}
      <div className="flex w-full flex-wrap gap-2 text-[10px] text-[var(--muted)]">
        {mode === "manual" ? (
          <span>code · 직접</span>
        ) : (
          <>
            <Dot ok={ready.vision} label="OpenAI" />
            <Dot ok={ready.firstPass} label="Jev" iri />
          </>
        )}
        {runs > 0 && <span className="tnum">· 지금까지 {runs}회</span>}
      </div>
    </header>
  );
}

function Dot({ ok, label, iri }: { ok: boolean; label: string; iri?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={ok && iri ? "iri h-1.5 w-1.5 rounded-full" : "h-1.5 w-1.5 rounded-full"}
        style={{ background: ok && !iri ? "var(--gen-strong)" : ok ? undefined : "var(--line)" }}
      />
      {label}
      {!ok && " 없음"}
    </span>
  );
}

function Home({
  onFiles,
  busy,
  ready,
  quota,
  mode,
  quotaSpent,
  dong,
  onDong,
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
  ready: { vision: boolean; firstPass: boolean };
  quota: { limit: number; left: number | null };
  mode: Mode;
  /** 오늘 맛보기 몫을 다 썼나. 그래서 직접 적는 길로 열린 것인지 화면이 말해 준다. */
  quotaSpent: boolean;
  dong: string | null;
  onDong: (name: string | null, choice: DongChoice | null) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <section className="space-y-3">
      <DongPicker value={dong} onChange={onDong} disabled={busy} />

      {mode === "manual" && quotaSpent && (
        <p className="text-[11.5px] text-[var(--muted)]">
          <b className="text-[var(--ink)]">오늘 몫을 다 쓰셨습니다</b>(하루 {quota.limit}장).
          지금부터는 수동으로 작동합니다.{" "}
          <a
            href="https://github.com/patrol-jev/patrol-jev"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            받아서
          </a>{" "}
          본인 키로 쓰시면 장수 제한이 없습니다.
        </p>
      )}

      {mode === "auto" && quota.limit > 0 && quota.left !== null && (
        <p className="text-[11.5px] text-[var(--muted)]">
          맛보기라 하루 {quota.limit}장까지 읽어 드립니다.{" "}
          <b className="text-[var(--ink)]">오늘 {quota.left}장 남음.</b> 제한 없이 쓰시려면{" "}
          <a
            href="https://github.com/patrol-jev/patrol-jev"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            받아서
          </a>{" "}
          본인 키로 쓰세요.
        </p>
      )}

      <label
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          onFiles([...event.dataTransfer.files].filter(isImageFile));
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl px-6 py-10 text-center ${over ? "iri-edge" : ""}`}
        style={{ background: "var(--wash)", border: over ? "1px solid transparent" : "1px dashed var(--line)" }}
      >
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="hidden"
          disabled={busy}
          onChange={(event) => onFiles([...(event.target.files ?? [])].filter(isImageFile))}
        />
        <CameraMark />
      </label>

      {!ready.vision && (
        <p className="text-[11.5px] text-[var(--muted)]">
          <b className="text-[var(--ink)]">OPENAI_API_KEY</b> 가 없어 사진을 글로 옮기지
          못합니다. <b className="text-[var(--ink)]">직접 적기</b>는 키 없이 그대로 씁니다.
          사진까지 읽히려면 `.env.example` 을 `.env.local` 로 복사해 키를 넣고 다시 띄워 주세요.
        </p>
      )}
      {mode === "auto" && ready.vision && !ready.firstPass && (
        <p className="text-[11.5px] text-[var(--muted)]">
          <b className="text-[var(--ink)]">TYPESAFE_API_KEY</b> 가 없어 1차 판단 없이 돕니다. 갈래는
          전부 「모르겠음」으로 두고 사람이 정하게 됩니다. 묶기와 일지 글은 그래도 나옵니다.
        </p>
      )}

      <ol className="grid gap-2 text-[11.5px] text-[var(--muted)] sm:grid-cols-3">
        {mode === "auto" ? (
          <>
            <li className="rounded-lg p-3" style={{ border: "1px solid var(--line)" }}>
              <b className="text-[var(--ink)]">1. 사진 → 글</b>
              <br />
              생성 모델이 보고 글로 적습니다. (시각)
            </li>
            <li className="rounded-lg p-3" style={{ border: "1px solid var(--line)" }}>
              <b className="iri-text">2. 글 → 판정</b>
              <br />
              Jev 가 네 갈래 중 하나로 가릅니다. (판단)
            </li>
          </>
        ) : (
          <>
            <li className="rounded-lg p-3" style={{ border: "1px solid var(--line)" }}>
              <b className="text-[var(--ink)]">1. 사진 → 자리</b>
              <br />
              찍힌 시각으로 묶습니다. 없으면 장수로. (자동)
            </li>
            <li className="rounded-lg p-3" style={{ border: "1px solid var(--line)" }}>
              <b className="text-[var(--ink)]">2. 자리와 말</b>
              <br />
              담당자가 채웁니다. 말을 고르면 란이 따라옵니다.
            </li>
          </>
        )}
        <li className="rounded-lg p-3" style={{ border: "1px solid var(--line)" }}>
          <b className="text-[var(--ink)]">3. 판정 → 글</b>
          <br />
          프로그램이 마무리합니다. (자동)
        </li>
      </ol>
    </section>
  );
}

function AddMore({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  return (
    <label
      className="flex cursor-pointer items-center justify-center rounded-xl px-4 py-3 text-[12px] text-[var(--muted)]"
      style={{ border: "1px dashed var(--line)" }}
    >
      <input
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="hidden"
        disabled={busy}
        onChange={(event) => onFiles([...(event.target.files ?? [])].filter(isImageFile))}
      />
      사진 더 넣기 (오늘 일지에 이어 쌓입니다)
    </label>
  );
}

function Baseline({ onDone }: { onDone: (minutes: number | null) => void }) {
  const [value, setValue] = useState("");

  return (
    <section
      className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 text-[12px]"
      style={{ background: "var(--wash)" }}
    >
      <span>지금까지 순찰일지 하나 쓰는 데 얼마나 걸리셨나요?</span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))}
        inputMode="numeric"
        placeholder="분"
        className="tnum w-16 rounded-md px-2 py-1"
        style={{ background: "var(--paper)", border: "1px solid var(--line)", color: "var(--ink)" }}
      />
      <button
        onClick={() => onDone(value ? Number(value) : null)}
        className="rounded-md px-3 py-1 text-[12px]"
        style={{ background: "var(--ink)", color: "var(--paper)" }}
      >
        적기
      </button>
      <button onClick={() => onDone(null)} className="text-[11px] text-[var(--muted)] underline">
        건너뛰기
      </button>
      <span className="w-full text-[10.5px] text-[var(--muted)]">
        한 번만 묻습니다. 이 값이 있어야 나중에 「얼마나 줄었나」를 말할 수 있습니다. 브라우저에만
        남고 아무 데도 보내지 않습니다.
      </span>
    </section>
  );
}

function Footer({ runs }: { runs: number }) {
  const [open, setOpen] = useState(false);
  const stats = open ? summarise(readRuns()) : null;

  return (
    <footer className="mt-auto pt-4 text-[10.5px] text-[var(--muted)]">
      {/* 좁은 화면에서 한 줄로 두면 글자가 잘린다. 두 줄로 나눠 둔다. */}
      <p>
        <button onClick={() => setOpen(!open)} className="underline underline-offset-2">
          사용 기록 {runs}회
        </button>
        {" · 개인정보를 다루지 않습니다"}
      </p>
      <p>
        {"기록은 이 컴퓨터에 저장되고 아무 데도 보내지 않습니다 · "}
        <a
          href="https://github.com/patrol-jev/patrol-jev"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          MIT
        </a>
      </p>
      {stats && (
        <p className="tnum mt-1">
          {stats.runs}회 · {stats.photos}장 · 한 회차 중앙값 {stats.medianSeconds}초
          {stats.baselineMinutes !== null && ` · 도입 전 ${stats.baselineMinutes}분`}
        </p>
      )}
    </footer>
  );
}

// ── 잔심부름 ──────────────────────────────────────────

/** 열쇠가 있으면 같이 보낸다. 없으면 아무것도 안 붙는다. */
function passHeader(pass: string | null): Record<string, string> {
  return pass ? { "x-patrol-pass": pass } : {};
}

async function post<T>(url: string, body: unknown, pass: string | null = null): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...passHeader(pass) },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `요청이 실패했습니다 (${response.status})`);
  return payload;
}

/** 동시에 몇 개까지. 한 번에 다 던지면 한도에 걸려 오히려 느려진다. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    }),
  );
}

/**
 * 지난번에 **그 자리에서** 사람이 정해 준 갈래를 얹는다.
 *
 * 주소가 같은 자리에만 얹는다. 온 동네에 퍼지는 규칙이 아니라 **그 한 자리의 사정**이다.
 *
 * 기계가 정한 값 위에도 얹는다. 옹벽에 금이 가 있고 도로가 파손된 자리라 기계는 늘
 * 「위험시설물」로 본다. 그 판단이 틀린 것은 아니지만, 그 자리에서 담당자가 하는 일은
 * 청소이고 일지에 적는 란도 순찰사항이다. 그건 사진에 안 보이는 사정이라 기계가 알 수 없다.
 * 한 번 고쳐 놓고 다음 회차에 또 고쳐야 한다면 배웠다고 할 수 없다.
 *
 * 대신 **덮었다는 것을 숨기지 않는다** — 카드에 「지난번 고친 대로」와 기계가 본 갈래를
 * 같이 적는다. 그 자리에 정말 다른 일이 생긴 날에는 사람이 도로 고치면 되고, 그러면
 * 기억도 그 값으로 바뀐다.
 */
function applyLearned(
  groups: Group[],
  learned: Record<string, string>,
  works: ReturnType<typeof readWorks>,
): Group[] {
  return groups.map((group) => {
    const address = group.address.trim();
    if (!address) return group;

    // 그 자리에 적기로 해 둔 말이 있으면 얹는다.
    const work = recallWork(address, works) ?? undefined;

    const remembered = recallLane(address, learned);
    if (!remembered || remembered === "unknown" || remembered === group.lane) {
      return work ? { ...group, work } : group;
    }
    return { ...group, lane: remembered as LaneOrUnknown, learned: true, work };
  });
}

/**
 * 사진 칸의 표식. 글자 없이 이것 하나만 둔다 — 무엇을 하는 칸인지 한눈에 보인다.
 *
 * 굵은 테두리에 주황 몸통. 도구의 표식이라 **Jev 무지개와는 색이 다르다** — 무지개는
 * 「Jev 가 낸 값」에만 쓰는 표시라, 표식이 그 자리를 빌려 쓰면 규칙이 흐려진다.
 * 테두리는 글자색을 따라가 밝은 화면에서도 어두운 화면에서도 읽힌다.
 */
function CameraMark() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      role="img"
      aria-label="사진"
      style={{ color: "var(--ink)" }}
    >
      {/* 몸통 — 각진 상자가 아니라 둥글고 도톰하게. */}
      <path
        d="M10 20c0-3.3 2.7-6 6-6h3.2c1.1 0 2.1-.6 2.6-1.5l1-1.8c.5-.9 1.5-1.5 2.6-1.5h5.2c1.1 0 2.1.6 2.6 1.5l1 1.8c.5.9 1.5 1.5 2.6 1.5H40c3.3 0 6 2.7 6 6v15c0 3.3-2.7 6-6 6H16c-3.3 0-6-2.7-6-6V20Z"
        fill="#F9871F"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />

      {/* 렌즈 */}
      <circle cx="28" cy="28" r="8.4" fill="var(--paper)" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="24.8" cy="24.8" r="1.9" fill="currentColor" opacity="0.85" />

      {/* 플래시 */}
      <circle cx="40" cy="20.5" r="1.7" fill="currentColor" />

      {/* 눌렀다는 기척. 캐릭터의 움직임 선에서 가져왔다. */}
      <path
        d="M5.5 16.5 3 13M50.5 16.5 53 13"
        stroke="#F9871F"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 그 란이 기본으로 적는 말. 카드가 「비우면 이렇게 적힌다」를 보여 줄 때 쓴다. */
function defaultWorkOf(lane: LaneOrUnknown, say: Wording): string {
  if (lane === "risk_facility") return say.facilityWork;
  if (lane === "flood_season") return say.drainWork;
  return say.patrolWork;
}

/**
 * 아이폰 사진을 펴는 데 도구를 한 번 받는다. 몇 초 멈춰 있으면 사람은 고장인 줄 안다.
 * 무슨 일이 일어나는지 먼저 말해 둔다.
 */
const HEIC_NOTE =
  "아이폰 사진(HEIC)이 있어 브라우저에서 펴서 씁니다. 펴는 도구를 처음 한 번 내려받느라 " +
  "잠깐 걸립니다. 원본은 나가지 않습니다.";

/**
 * 못 연 사진을 사람 말로. **이름을 적는다** — 「2장 실패」만으로는 어느 것인지 알 수 없어
 * 다시 올려 볼 수도, 빼고 갈 수도 없다.
 */
function failedNote(failed: FailedPhoto[]): string {
  const names = failed.slice(0, 3).map((one) => one.name).join(" · ");
  const more = failed.length > 3 ? ` 외 ${failed.length - 3}장` : "";
  return `${failed.length}장은 열지 못해 건너뜁니다 (${names}${more}). ${failed[0].why}`;
}

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}
