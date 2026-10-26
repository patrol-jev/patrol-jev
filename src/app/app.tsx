"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ClientConfig } from "@/core/config";
import { borrowStamps, buildGroups, decideLane, isShadeSpot, lineUp, markShade, snapYears } from "@/core/group";
import { LANES, type Lane, type LaneOrUnknown } from "@/core/lanes";
import {
  allPhrases,
  defaultPhrases,
  laneOfPhrase,
  manualGroups,
  splitManual,
  type Phrase,
} from "@/core/manual";
import { isPlate, isPlateShot } from "@/core/group";
import { buildIljiHwpx, PHOTO_RATIO, PHOTO_TABLES_PER_PAGE } from "@/core/hwpx/ilji";
import { slotsFromDay } from "@/core/weekly";
import { pickDoubts, pickPhotos, readReportText, type IljiSlots } from "@/core/ilji-slots";
import { buildReport, DEFAULT_WORDING, learnWording, type Wording } from "@/core/report";
import {
  commonDate,
  minutesBetween,
  readStamp,
  stampFromClock,
  type ShotStamp,
} from "@/core/shot-time";
import type { Described, FirstPassInput, Group, Judged, PhotoRole } from "@/core/types";
import { GroupCard } from "@/ui/group-card";
import { ManualCard } from "@/ui/manual-card";
import { Meter, Tracks } from "@/ui/jev";
import {
  IMAGE_ACCEPT,
  isImageFile,
  preparePhotos,
  type FailedPhoto,
  type Prepared,
  type PreparedPhoto,
  toBase64,
} from "@/ui/photo";
import { DayCalendar, PastDay } from "@/ui/days";
import { cellPhotoBytes, downloadBytes, recropJpeg, smallJpeg } from "@/ui/hwpx-photo";
import { PeriodReport } from "@/ui/period";
import { Pick, pickedLine, type Picked } from "@/ui/pick";
import { fillKeptForm } from "@/ui/form-bridge";
import { deletePhotos, loadPhotos, savePhotos } from "@/ui/photo-store";
import { proofOf, writeShotProof } from "@/core/shot-proof";
import { readManual, saveManual } from "@/ui/manual-pref";
import { customPeriod, monthPeriod, weekPeriod, type SavedSpot } from "@/core/period";
import { DongPicker, type DongChoice } from "@/ui/dong";
import { periodFormOf, ReportExtras, weeklyFormOf } from "@/ui/report-extras";
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
  removeDay,
  readLearned,
  readRuns,
  readWorks,
  readWording,
  recallLane,
  recallWork,
  runsBetween,
  runsCsv,
  saveDay,
  summarise,
  writeBaseline,
  writeDong,
} from "@/ui/usage";
import { LayerStack } from "@/ui/layer-stack";
import { downloadRunsCsv, WorkLine } from "@/ui/work-line";

type Stage = "home" | "field" | "report" | "calendar";
type Phase = "idle" | "prepare" | "describe" | "judge" | "done";
/**
 * 어느 길로 만드는가.
 *   auto   = 사진을 모델이 읽는다(키가 있고 한도가 남았을 때).
 *   manual = 모델을 한 번도 안 부르고 사람이 자리와 말을 적는다. 비용 0, 사진은 안 나간다.
 */
type Mode = "auto" | "manual";

/** `/api/quota` 가 주는 것. */
interface QuotaBody {
  limit?: number;
  left?: number | null;
}

export default function PatrolApp({
  config,
  ready,
}: {
  config: ClientConfig;
  ready: { vision: boolean; eye: string | null; firstPass: boolean };
}) {
  const [stage, setStage] = useState<Stage>("home");
  const [phase, setPhase] = useState<Phase>("idle");
  /** 홈에서 무엇을 뽑기로 했나. 고르기 전에는 뽑기 화면, 고른 뒤에는 그 길만 보인다. 이 회차 동안만 기억한다. */
  const [pick, setPick] = useState<Picked | null>(null);
  const [resultBusy, setResultBusy] = useState(false);
  const [resultNote, setResultNote] = useState<string | null>(null);
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
  /** 올린 직후 한 번 떴다 사라지는 알림. 화면 틀 안에 자리를 차지하지 않는다. */
  const [toast, setToast] = useState<string | null>(null);
  // 고정된 함수로 넘긴다. 도는 동안 화면이 자주 다시 그려지는데, 그때마다 새 함수면 닫는 시계가 매번 처음부터 돈다.
  const closeToast = useCallback(() => setToast(null), []);

  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  /** 사진 줄이기 진행. 숫자가 안 움직이면 멈춘 것으로 보인다. */
  const [opening, setOpening] = useState({ done: 0, total: 0 });
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
  /** 달력 탭에서 고른 날의 일지를 파일로 낼 때. */
  const [pastBusy, setPastBusy] = useState(false);
  const [pastNote, setPastNote] = useState<string | null>(null);
  /** 맛보기 한도. limit 0 이면 한도가 없다(로컬에 받아 쓰는 경우). */
  const [quota, setQuota] = useState<{ limit: number; left: number | null }>({ limit: 0, left: null });
  const pass = useRef<string | null>(null);

  /**
   * 사진 읽기를 지금 쓸 수 있나. 키가 있고 오늘 몫이 남아 있어야 한다.
   * 이 값을 상태로 복사해 두지 않는다. 두 벌이 되면 반드시 어긋난다.
   */
  const canRead = ready.vision && !(quota.limit > 0 && quota.left === 0);
  /**
   * 사람이 「수동」을 골랐나. 누르지 않았으면 이 브라우저가 기억해 둔 값이다(`ui/manual-pref.ts`).
   * 사진을 밖으로 내보내면 안 되는 자리에서 쓰는 길이라 한 번 켜면 다음에도 켜져 있다.
   */
  const storedManual = useSyncExternalStore(subscribeNothing, readManual, onServer);
  const [manualPick, setManualPick] = useState<boolean | null>(null);
  const wantManual = manualPick ?? storedManual;
  /**
   * 지금 들어가는 길.
   * 사진을 읽을 수 있고 사람이 수동을 고르지 않았으면 읽는다.
   * 키가 없거나 오늘 몫을 다 썼거나 수동을 골랐으면 직접 적는다.
   */
  const mode: Mode = canRead && !wantManual ? "auto" : "manual";
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
  /** 이 브라우저에 받아 둔 부서 양식의 이름. 뽑기의 양식 걸음이 이것으로 열리거나 건너뛴다. 붙은 뒤에만 읽는다. */
  const officeIljiName = useMemo(() => {
    void logVersion; // 양식을 올리거나 지우면 기록이 바뀌어 다시 읽는다.
    return mounted ? (weeklyFormOf()?.name ?? null) : null;
  }, [mounted, logVersion]);
  const officePeriodName = useMemo(() => {
    void logVersion;
    return mounted ? (periodFormOf()?.name ?? null) : null;
  }, [mounted, logVersion]);
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
   * **말을 고르면 란이 따라온다**. 그래야 사람이 채울 칸이 자리와 말 둘로 끝난다.
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

  /**
   * 지금 화면의 일지를 **자리**로 모은다. 기본 양식 파일도 부서 양식도 이 값을 그린다.
   *
   * 글이 원천이다. 화면의 글(고친 것 포함)을 자리로 나눠 담고, 자리마다 사진 한 장을 붙인다.
   * 주소판은 빼고 치운 뒤 사진이 있으면 그것을 고른다. 사진은 셀 비율로 잘라 브라우저 안에서 넣는다.
   */
  const collectSlots = useCallback(
    async (ratio: number): Promise<IljiSlots> => {
      // 사진 칸에서 빼는 주소판은 묶기보다 좁게 본다. 벽의 작은 번호판을 읽어 온 작업 사진까지 빼면 후 칸이 빈다.
      const plateAt = (index: number) => isPlateShot(judged[index], described[index]?.signText, config.thresholds);
      const stageScore = (index: number, stage: "before" | "after") => {
        const judgment = judged[index];
        return judgment?.stage === stage ? (judgment.stageProbabilities?.[stage] ?? 0) : 0;
      };
      const picks = pickPhotos(groups, plateAt, stageScore, madeBy === "manual");
      const shot = async (index: number | null) => {
        if (index === null) return null;
        const photo = photoByIndex[index];
        const bytes = await cellPhotoBytes(photo?.url, ratio);
        return bytes ? writeShotProof(bytes, proofOf(photo?.date, photo?.time, photo?.timeFrom)) : null;
      };
      const photos = await Promise.all(
        picks.map(async (pick) => ({
          caption: pick.caption,
          note: pick.note,
          pair: pick.pair,
          before: await shot(pick.before),
          after: await shot(pick.after),
        })),
      );
      const read = readReportText(reportText);
      const dongName = dongLabel ?? config.dong;
      // 란마다 몇 자리였나. 보고서가 센 값을 그대로 옮긴다.
      const keyOf = { waste_cleanup: "patrol", flood_season: "seasonal", risk_facility: "facility" } as const;
      const counts = Object.fromEntries(report.blocks.map((block) => [keyOf[block.key], block.count]));
      return {
        dong: dongName,
        unit: config.unit,
        officer: config.officer,
        dateLabel: read.dateLabel || date,
        area: read.area || `${dongName} 관내`,
        rows: read.rows,
        counts,
        photos,
      };
    },
    [config, date, described, dongLabel, groups, judged, madeBy, photoByIndex, report.blocks, reportText],
  );

  /** 한글 파일(기본 양식). 서버로는 아무것도 안 간다. */
  const makeHwpx = useCallback(async () => {
    const slots = await collectSlots(PHOTO_RATIO);
    downloadBytes(buildIljiHwpx(slots), `${slots.dong} 현장 순찰 일지(기본 양식) ${date}.hwpx`);
    // 파일로 받아 갔으면 복사한 것과 같다. 중간에 그만둔 회차가 아니다.
    setCopied(true);
  }, [collectSlots, date]);

  /**
   * 뽑기에서 고른 양식으로 순찰일지를 바로 낸다. 부서 양식을 골랐는데 이 브라우저에 없으면 기본 양식으로 내고 그렇다고 적는다.
   * 보고서 탭의 두 단추와 같은 코드다. 고르는 일은 홈에서 끝났으니 여기서는 결과만.
   */
  const getResult = useCallback(
    async (form: "office" | "basic" = pick?.form ?? "basic") => {
      setResultBusy(true);
      setResultNote(null);
      try {
        if (form === "office") {
          const note = await fillKeptForm(collectSlots, date);
          if (note !== null) {
            setResultNote(note);
            setCopied(true);
            return;
          }
          setResultNote("부서 양식이 이 브라우저에 없어 기본 양식으로 냈어요.");
        }
        await makeHwpx();
        setResultNote((current) => current ?? "기본 양식으로 내려받았어요.");
      } catch (cause) {
        setResultNote(cause instanceof Error ? cause.message : "파일을 만들지 못했어요.");
      } finally {
        setResultBusy(false);
      }
    },
    [collectSlots, date, makeHwpx, pick],
  );

  /** 보고서 자리. 결과 카드의 「글 보기 · 고치기」가 여기로 화면을 내린다. 단추를 눌렀는데 화면이 그대로면 안 눌린 줄 안다. */
  const reportRef = useRef<HTMLDivElement | null>(null);
  /** 부서 양식 올리는 자리. 양식이 아직 없는 브라우저에서 「부서 양식 받기」를 누르면 여기로 내린다. */
  const formRef = useRef<HTMLDivElement | null>(null);
  const openReport = useCallback((to: "report" | "form" = "report") => {
    setStage("report");
    requestAnimationFrame(() => (to === "form" ? formRef : reportRef).current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  /** 결과 카드의 「부서 양식 받기」. 올려 둔 양식이 있으면 바로 채우고, 없으면 올리는 자리로 데려간다. */
  const getOffice = useCallback(() => {
    if (officeIljiName) {
      void getResult("office");
      return;
    }
    setResultNote("부서 양식을 아직 안 올렸어요. 아래에서 본인 동 양식(.hwpx)을 한 번 올리면 다음부터 바로 나와요.");
    openReport("form");
  }, [getResult, officeIljiName, openReport]);

  /**
   * 보고서 · 주간 일지를 뽑는 길에서 사진을 올려 회차가 끝났다. 그 날이 고른 기간 밖이면 기간을 그 날이 든 주 · 달로 옮겨서 보인다.
   * 「지난 주」를 골랐는데 오늘 사진을 올리면 지난 주 보고서는 비어 있다. 흐름이 거기서 끊기지 않게 한다. 고른 값은 안 바꾸고 보일 때만 옮긴다.
   */
  const shifted = useMemo((): { pick: Picked | null; note: string | null } => {
    if (phase !== "done" || !pick || pick.want === "ilji" || groups.length === 0) return { pick, note: null };
    const period = pick.kind === "month" && pick.month ? monthPeriod(pick.month) : pick.kind === "week" && pick.week ? weekPeriod(pick.week) : pick.kind === "custom" && pick.from && pick.to ? customPeriod(pick.from, pick.to) : null;
    if (!period || (date >= period.from && date <= period.to)) return { pick, note: null };
    const moved: Picked =
      pick.kind === "month"
        ? { ...pick, month: date.slice(0, 7) }
        : pick.kind === "week"
          ? { ...pick, week: date }
          : { ...pick, from: date < period.from ? date : period.from, to: date > period.to ? date : period.to };
    const day = `${date.slice(5, 7).replace(/^0/, "")}월 ${date.slice(8, 10).replace(/^0/, "")}일`;
    return { pick: moved, note: `올린 사진이 ${day} 것이라 기간을 그 날이 든 ${pick.kind === "month" ? "달" : pick.kind === "week" ? "주" : "날까지"}로 맞췄어요.` };
  }, [date, groups.length, phase, pick]);

  /** 달력에서 고른 날을 일지 자리로. 보관한 사진 사본을 그 양식의 칸 비율로 자른다. 주간 일지가 하루를 모으는 것과 같은 코드다. */
  const collectPast = useCallback(
    async (ratio: number): Promise<IljiSlots> => {
      if (!pastRecord) throw new Error("날을 먼저 고르세요.");
      const stored = await loadPhotos(pastRecord.date);
      const items = stored
        ? await Promise.all(
            stored.items.map(async (item) => ({
              before: item.before ? await recropJpeg(item.before, ratio) : null,
              after: item.after ? await recropJpeg(item.after, ratio) : null,
            })),
          )
        : null;
      return slotsFromDay(pastRecord, items, config.officer, config.unit, PHOTO_TABLES_PER_PAGE);
    },
    [config.officer, config.unit, pastRecord],
  );

  /** 달력 탭의 「이 날 순찰일지 받기」. 부서 양식이 있으면 그 양식, 없으면 기본 양식. 서버로는 아무것도 안 간다. */
  const getPast = useCallback(
    async (form: "office" | "basic") => {
      if (!pastRecord) return;
      setPastBusy(true);
      setPastNote(null);
      try {
        if (form === "office") {
          const note = await fillKeptForm(collectPast, pastRecord.date);
          if (note !== null) {
            setPastNote(note);
            return;
          }
        }
        const slots = await collectPast(PHOTO_RATIO);
        downloadBytes(buildIljiHwpx(slots), `${slots.dong} 현장 순찰 일지(기본 양식) ${pastRecord.date}.hwpx`);
        setPastNote("기본 양식으로 내려받았어요.");
      } catch (cause) {
        setPastNote(cause instanceof Error ? cause.message : "파일을 만들지 못했어요.");
      } finally {
        setPastBusy(false);
      }
    },
    [collectPast, pastRecord],
  );

  /** 알릴 말을 덮지 않고 잇는다. 한 회차에 알릴 것이 둘 이상일 수 있다. */
  const addNotice = useCallback((line: string) => {
    setNotice((current) => (current ? `${current} ${line}` : line));
  }, []);
  /** 앞서 적은 한 줄을 새 줄로 바꾼다. 나중에 안 사실이 앞 문장과 어긋나면 앞 문장은 지운다. 둘 다 남으면 모순으로 읽힌다. */
  const swapNotice = useCallback((oldLine: string | null, line: string) => {
    setNotice((current) => {
      const rest = oldLine && current ? current.replace(oldLine, "").replace(/\s{2,}/g, " ").trim() : current;
      return rest ? `${rest} ${line}` : line;
    });
  }, []);

  const refreshQuota = useCallback(() => {
    fetch("/api/quota", { headers: passHeader(pass.current) })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: QuotaBody | null) => {
        if (!body) return;
        setQuota({ limit: body.limit ?? 0, left: body.left ?? null });
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
   * 수동 모드. **모델을 한 번도 부르지 않는다.**
   *
   * 사진은 브라우저에서 줄이기만 하고 서버로 보내지 않는다(base64 도 안 만든다).
   * 코드가 사진에서 가져오는 것은 EXIF 시각 하나뿐이고, 그걸로 자리를 묶는다.
   * 주소와 말은 사람이 적는다. 묶기·시각·문장·학습은 자동 모드와 똑같은 코드가 한다.
   */
  const runManual = useCallback(
    async (opened: Prepared) => {
      if (opened.photos.length === 0) return;
      setPhase("prepare");
      logged.current = false;
      setMadeBy("manual");
      setOrderedBy(opened.ordered);
      // 팝업은 7초면 사라진다. 까닭 대목은 사람이 옮겨 적어야 하니 안내 줄에도 남긴다.
      const untimedNote = untimedToast(opened.photos, false);
      setToast(untimedNote);
      if (untimedNote) addNotice(untimedNote);
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
      // 이미 적어 둔 자리는 건드리지 않는다. 새로 넣은 사진만 뒤에 붙인다.
      // 통째로 다시 묶으면 사람이 친 주소가 날아간다.
      setGroups((current) => [...current, ...made]);
      setPhase("done");
    },
    [addNotice, config, manualLane],
  );

  /** 검수를 마친 사진이 오면 (A) 사진→글 → (B) 글→판정 → (C) 묶기 까지 한 번에 흐른다. */
  const run = useCallback(
    async (opened: Prepared) => {
      if (opened.photos.length === 0) return;
      setPhase("prepare");
      logged.current = false;
      setMadeBy("auto");
      setOrderedBy(opened.ordered);
      // 팝업은 7초면 사라진다. 까닭 대목은 사람이 옮겨 적어야 하니 안내 줄에도 남긴다.
      const untimedNote = untimedToast(opened.photos, true);
      setToast(untimedNote);
      if (untimedNote) addNotice(untimedNote);

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

      // 읽은 도로명이 고른 동의 색인에 없는 장이 더 많으면 사진과 「우리 동」이 어긋난 것이다.
      // 주소는 그대로 두고(고치지 않는다) 사람에게만 알린다. 동을 바꾸고 다시 올리면 대조가 된다.
      const mismatch = dongMismatch(Object.values(fresh));
      if (mismatch && dongLabel) {
        addNotice(
          `주소판 ${mismatch.read}장 가운데 ${mismatch.unknown}장의 도로명이 「${dongLabel}」 에 없습니다. ` +
            "사진과 「우리 동」 을 맞춰 주세요. 다른 동 사진이면 위에서 동을 바꾸고 다시 올리면 주소가 대조됩니다.",
        );
      }

      // ── (B) 글 → 판정. 빠른 쪽. 앞 장이 있어야 「같은 자리인가」를 물을 수 있다.
      setPhase("judge");
      const jevStarted = performance.now();
      const everything = { ...described, ...fresh };
      // 찍힌 시각은 EXIF 가 먼저다. 없으면 사진에 찍힌 워터마크를 코드가 읽는다.
      // 메신저로 오간 사진은 EXIF 가 벗겨져 오고, 그럴 때 시각은 화면 글자에만 남는다.
      const rawStamps: Record<number, ShotStamp | null> = {};
      for (const photo of all) {
        rawStamps[photo.index] =
          stampFromClock(photo.date, photo.time) ?? readStamp(everything[photo.index]?.textInPhoto);
      }
      // 연도만 다르게 읽힌 장은 그날로 맞추고, 시각이 아예 없는 장은 올라온 차례의 옆 장 시각을 빌린다.
      // 둘 다 09-26 실물에서 자리가 갈라진 까닭이었다. 무엇을 손댔는지는 한 줄 알린다.
      const snapped = snapYears(rawStamps);
      const stamps = borrowStamps(all, snapped);
      const snappedCount = all.filter((photo) => rawStamps[photo.index]?.date && snapped[photo.index]?.date !== rawStamps[photo.index]?.date).length;
      const borrowedCount = all.filter((photo) => stamps[photo.index]?.borrowed).length;
      if (snappedCount > 0) addNotice(`${snappedCount}장은 찍힌 글자의 연도가 다르게 읽혀 그날 날짜로 맞췄습니다.`);
      // 시각을 어디서 얻었는지 한 줄로. 사진을 열 때의 안내는 파일 속 기록만 본 것이라, 찍힌 글자에서 되찾은 장까지 더해
      // **그 안내를 이 줄로 바꾼다.** 둘 다 남으면 「기록이 없다」와 일지의 시각이 모순으로 읽힌다(09-27 사용자).
      const fromFile = all.filter((photo) => photo.timeFrom === "exif").length;
      const fromText = all.filter((photo) => photo.timeFrom !== "exif" && rawStamps[photo.index]).length;
      const none = all.filter((photo) => !stamps[photo.index]).length;
      swapNotice(untimedNote, timeSourceNote(all.length, fromFile, fromText, borrowedCount, none));

      // 되찾은 시각은 사진에 되돌려 적는다. 묶음 카드의 시각과 일지 머리글의 날짜가 이걸 쓴다.
      const timed = all.map((photo) => {
        const stamp = stamps[photo.index];
        if (!stamp || (photo.date && photo.time && photo.date === stamp.date)) return photo;
        return {
          ...photo,
          date: stamp.date || photo.date,
          time: photo.time || stamp.time,
          timeFrom: photo.timeFrom ?? (stamp.borrowed ? ("neighbor" as const) : ("text" as const)),
        };
      });
      // 사진 속 글자까지 더해 시각을 아는 장은 그 차례로 줄 세우고, 모르는 장은 뒤로 뺀다. 폰 사진첩은
      // 최신이 앞이라 올라온 차례가 거꾸로일 때가 많고, 그러면 앞 장과의 간격이 전부 음수라 자리가
      // 낱장으로 흩어진다. 묶기(`buildGroups`)도 같은 규칙으로 줄을 서니 화면과 묶음이 어긋나지 않는다.
      const everyTimed = timed.every((photo) => stamps[photo.index]);
      const lined = lineUp(timed, stamps);
      setPhotos(lined);
      setOrderedBy(everyTimed ? "time" : "given");


      const inputs: FirstPassInput[] = prepared.map((photo) => {
        const position = lined.findIndex((item) => item.index === photo.index);
        const before = position > 0 ? lined[position - 1] : null;
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
      // 지난번에 사람이 정해 준 자리는 그대로 따른다. 갈래가 안 선 자리에만 얹는다.
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
    [addNotice, config, described, dong, dongLabel, judged, photos, refreshQuota, swapNotice],
  );

  /**
   * 사진을 받는 자리. 열고 줄인 뒤 바로 (A)(B)(C) 로 흐른다.
   * 어느 길(모델/직접)로 갈지는 들어올 때 정한다. 한도를 다 썼으면 직접 적는 길이다.
   */
  const intake = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setNotice(null);
      setEditedReport(null);

      // 맛보기 자리에서는 남은 만큼만 받는다. 30장을 올렸다가 10장에서 멈추는 것이 제일 나쁘다.
      let taking = files;
      let way: Mode = mode;
      if (way === "auto" && quota.limit > 0 && quota.left !== null) {
        if (quota.left <= 0) {
          // 그 자리에서 수동으로 이어 간다. 묶기·시각·문장은 그대로 나온다.
          way = "manual";
          addNotice(
            `맛보기는 하루 ${quota.limit}장까지라 오늘은 다 읽었습니다. ` +
              "사진 읽기만 빼고 직접 적는 길로 이어 갑니다. 묶기와 일지 글은 그대로 나옵니다. " +
              "받아서 본인 키로 쓰시면 장수 제한이 없습니다.",
          );
        } else if (files.length > quota.left) {
          taking = files.slice(0, quota.left);
          addNotice(
            `맛보기는 하루 ${quota.limit}장까지라 앞의 ${taking.length}장만 읽습니다. ` +
              "마지막 자리는 중간에서 잘릴 수 있습니다. " +
              "받아서 본인 키로 쓰시면 장수 제한이 없습니다.",
          );
        }
      }
      setMadeBy(way);
      setStage("field");
      setPhase("prepare");
      logged.current = false;

      let opened: Prepared;
      try {
        setOpening({ done: 0, total: taking.length });
        opened = await preparePhotos(taking, config.vision.maxEdge, nextIndex(photos), (done, total) =>
          setOpening({ done, total }),
        );
        setOpening({ done: 0, total: 0 });
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

      // 모델로 가는 길이면 여기서 보낼 사본(base64)을 만든다. 직접 적는 길은 안 만든다. 사진이 안 나간다.
      let ready: Prepared = opened;
      if (way === "auto") {
        try {
          const withData = await Promise.all(opened.photos.map(async (photo) => ({ ...photo, data: await toBase64(photo.blob) })));
          ready = { ...opened, photos: withData };
        } catch (cause) {
          setPhase("idle");
          setError(cause instanceof Error ? cause.message : "사진을 준비하지 못했습니다.");
          return;
        }
      }
      void (way === "manual" ? runManual(ready) : run(ready));
    },
    [addNotice, config.vision.maxEdge, mode, photos, quota, run, runManual],
  );

  /** 사진을 받는 자리는 하나다. */
  const take = useCallback(
    (files: File[]) => {
      void intake(files);
    },
    [intake],
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
        learnedLanes: groups.filter((group) => group.learned).length,
        roadMatched: Object.values(described).filter((d) => d.roadKnown === true).length,
      },
      config.log.mode,
    );
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
    mode,
    report,
  ]);

  /* ── 그날 일지를 남긴다 ──────────────────────────────────
   *
   * 달력에서 다시 꺼내 보고, 기간 보고서가 세는 것이 이것이다. 회차가 끝난 뒤 **고칠 때마다** 같은
   * 날짜를 덮어쓴다(합치기·나누기·갈래·말·글). 글과 자리 목록은 localStorage 에, 일지에 실린 사진의
   * 작은 사본은 IndexedDB 에 같은 날짜로 남는다. 둘 다 이 기기 안이다. 보내는 코드는 없다.
   * 사진은 어느 장을 싣는지가 바뀌었을 때만 다시 만든다(고칠 때마다 스무 장을 다시 그리지 않게).
   */
  const savedShots = useRef("");
  useEffect(() => {
    if (phase !== "done" || groups.length === 0 || config.log.mode === "off") return;
    const plateAt = (index: number) => isPlateShot(judged[index], described[index]?.signText, config.thresholds);
    const stageScore = (index: number, stage: "before" | "after") => {
      const judgment = judged[index];
      return judgment?.stage === stage ? (judgment.stageProbabilities?.[stage] ?? 0) : 0;
    };
    const picks = pickPhotos(groups, plateAt, stageScore, madeBy === "manual");
    const byId = new Map(groups.map((group) => [group.id, group]));
    const proofAt = (index: number | null) => {
      const photo = index === null ? undefined : photoByIndex[index];
      return proofOf(photo?.date, photo?.time, photo?.timeFrom);
    };
    const spots: SavedSpot[] = picks.map((pick) => {
      const group = byId.get(pick.groupId);
      const doubts = group ? pickDoubts(group, pick, plateAt, stageScore) : [];
      return {
        address: group?.address ?? "",
        lane: group?.lane ?? "unknown",
        work: group?.work?.trim() ?? "",
        time: group?.time ?? "",
        shade: group?.shade,
        pair: pick.pair,
        before: pick.before !== null,
        after: pick.after !== null,
        shots: { before: proofAt(pick.before), after: proofAt(pick.after) },
        ...(doubts.length > 0 ? { doubts } : {}),
      };
    });
    const timer = setTimeout(() => {
      saveDay({
        date,
        savedAt: new Date().toISOString(),
        photos: photos.length,
        groups: groups.length,
        report: reportText,
        dong: dongLabel ?? config.dong,
        spots,
        undecided: groups.filter((group) => group.lane === "unknown").length,
      });
      setLogVersion((n) => n + 1);
    }, 400);

    const signature = `${date}|${picks.map((pick) => `${pick.before ?? ""}/${pick.after ?? ""}`).join(",")}`;
    let cancelled = false;
    if (signature !== savedShots.current) {
      savedShots.current = signature;
      void (async () => {
        // 통째로 줄여 둔다. 칸 비율로 자르는 일은 파일을 낼 때 한다. 여기서 기본 양식 비율로 잘라 두면
        // 비율이 다른 부서 양식에서 한 번 더 잘려, 세로 사진은 3분의 1만 남는다(10-03 실물 보고서).
        const shot = async (index: number | null) => {
          if (index === null) return null;
          const bytes = await smallJpeg(photoByIndex[index]?.url, 960);
          return bytes ? writeShotProof(bytes, proofAt(index)) : null;
        };
        const items = await Promise.all(picks.map(async (pick) => ({ before: await shot(pick.before), after: await shot(pick.after) })));
        if (!cancelled) await savePhotos({ date, items });
      })();
    }
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [phase, groups, judged, described, photos.length, photoByIndex, config.log.mode, config.dong, config.thresholds, date, dongLabel, madeBy, reportText]);

  // ── 사람이 고치는 자리 ────────────────────────────────

  /** 자리마다 지금 일지의 전 칸·후 칸에 실리는 장. 카드가 장별로 보여 주고, 사람이 거기서 바꾼다. */
  const pickById = useMemo(() => {
    const plateAt = (index: number) => isPlateShot(judged[index], described[index]?.signText, config.thresholds);
    const stageScore = (index: number, stage: "before" | "after") => {
      const judgment = judged[index];
      return judgment?.stage === stage ? (judgment.stageProbabilities?.[stage] ?? 0) : 0;
    };
    return new Map(pickPhotos(groups, plateAt, stageScore, madeBy === "manual").map((pick) => [pick.groupId, pick]));
  }, [config.thresholds, described, groups, judged, madeBy]);

  /** 한 장의 쓰임을 정한다. 전·후는 한 자리에 한 장씩이라, 같은 쓰임을 가졌던 다른 장은 자동으로 돌린다. */
  const setRole = (id: string, photoIndex: number, role: PhotoRole | null) =>
    touch(id, (g) => {
      const roles: Record<number, PhotoRole> = {};
      for (const index of g.photos) {
        const kept = g.roles?.[index];
        if (index === photoIndex || kept === undefined) continue;
        if (role !== null && role !== "skip" && kept === role) continue;
        roles[index] = kept;
      }
      if (role !== null) roles[photoIndex] = role;
      return { ...g, roles: Object.keys(roles).length > 0 ? roles : undefined };
    });

  const touch = (id: string, change: (group: Group) => Group) => {
    setEdits((n) => n + 1);
    setGroups((current) =>
      current.map((g) => {
        if (g.id !== id) return g;
        const next: Group = { ...change(g), edited: true, learned: false };
        // 주소가 있는 자리에서 갈래를 고쳤으면 그 자리를 기억해 둔다. 다음에 같은 자리면 그대로 둔다.
        if (next.address.trim() && next.lane !== g.lane) learnLane(next.address, next.lane);
        // 사람이 계절특수로 고친 자리도 그늘막인지는 캡션에서 다시 읽는다. 아니면 배수구 말이 나간다.
        if (next.lane !== g.lane) {
          if (next.lane === "flood_season" && isShadeSpot(next.photos, Object.values(described))) next.shade = true;
          else delete next.shade;
        }
        return next;
      }),
    );
  };

  /**
   * 사진 옮기기. 한 자리에서 몇 장을 골라 다른 자리(연번)로 보내거나 새 자리로 뗀다.
   * 「위와 합치기」는 이웃끼리만 된다. 시각이 잘못 읽혀 멀리 떨어진 장은 이 길로 제자리에 넣는다.
   */
  const [moving, setMoving] = useState<{ from: string; picked: number[] } | null>(null);
  const startMove = (id: string) => setMoving({ from: id, picked: [] });
  const togglePick = (index: number) =>
    setMoving((m) => (m ? { ...m, picked: m.picked.includes(index) ? m.picked.filter((i) => i !== index) : [...m.picked, index] } : m));
  const moveTo = (targetId: string | null) => {
    if (!moving || moving.picked.length === 0) return;
    const { from, picked } = moving;
    setMoving(null);
    setEdits((n) => n + 1);
    setGroups((current) => {
      const at = current.findIndex((g) => g.id === from);
      if (at < 0) return current;
      // 화면에 줄 선 차례(시각순)로 다시 정렬한다. 옮겨 온 장이 뒤에 붙는 것이 아니라 제 시각 자리에 든다.
      const order = new Map(photos.map((p, i) => [p.index, i]));
      const lineUpIndices = (list: number[]) => [...list].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      const timeOf = (list: number[]) => list.map((i) => photoByIndex[i]?.time).filter(Boolean).sort()[0] ?? "";
      const rest = current[at].photos.filter((i) => !picked.includes(i));
      let next = current.map((g) => (g.id === from ? { ...g, photos: rest, edited: true, time: timeOf(rest) || g.time } : g));
      if (targetId === null) {
        const byIndex = new Map(Object.values(judged).map((j) => [j.index, j]));
        const lane: LaneOrUnknown = mode === "manual" ? "unknown" : decideLane(picked, byIndex, config.thresholds);
        const plate = picked.find((i) => isPlate(byIndex.get(i), described[i]?.signText, config.thresholds));
        const fresh: Group = {
          id: `${from}m${picked.join("_")}`,
          photos: lineUpIndices(picked),
          address: plate !== undefined ? (described[plate]?.signText ?? "") : "",
          lane,
          edited: true,
          time: timeOf(picked),
        };
        next.splice(at + 1, 0, fresh);
      } else {
        next = next.map((g) => {
          if (g.id !== targetId) return g;
          const merged = lineUpIndices([...g.photos, ...picked]);
          return { ...g, photos: merged, edited: true, time: timeOf(merged) || g.time };
        });
      }
      return next.filter((g) => g.photos.length > 0);
    });
  };

  /**
   * 자리 지우기(09-26 사용자). 목록에서 빼기만 한다. 사진은 `photos` 에 남아 화면 수는 그대로이고, 어느 자리에도 안 들어가니
   * 일지·한글 파일에는 안 실린다. 회차 대조(run-diff)에서는 「빠진 사진」 줄로 드러난다. 되돌리기는 없다. 단추가 두 번 눌러야 지운다.
   */
  const removeGroup = (id: string) => {
    setEdits((n) => n + 1);
    setGroups((current) => current.filter((g) => g.id !== id));
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
      // 주소는 주소판이 든 쪽이 가져간다. 둘 다 없으면(사람이 친 주소) 앞쪽. 전에는 두 쪽 다 비웠는데,
      // 그러면 나눈 뒤 이웃과 합칠 때 읽어 둔 주소가 사라졌다(실물 30장 정답 회차에서 두 자리가 그렇게 비었다).
      const hasPlate = (list: number[]) => list.some((i) => isPlate(byIndex.get(i), described[i]?.signText, config.thresholds));
      const addressGoesToHead = hasPlate(head) || !hasPlate(tail);
      const make = (photos: number[], suffix: string): Group => {
        const lane = decideLane(photos, byIndex, config.thresholds);
        const half: Group = {
          id: `${group.id}${suffix}`,
          photos,
          address: (suffix === "a") === addressGoesToHead ? group.address : "",
          lane,
          edited: true,
          time: photos.map((i) => photoByIndex[i]?.time).filter(Boolean).sort()[0] ?? "",
        };
        // 그늘막 표식은 자리를 나눈 뒤에도 캡션에서 다시 읽는다. 물려받으면 배수구 쪽이 그늘막 말을 쓴다.
        return markShade(half, Object.values(described));
      };

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

      {toast && <Toast key={toast} text={toast} onClose={closeToast} />}

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

      {stage === "home" && pick === null && (
        <Pick
          officeIlji={officeIljiName}
          officePeriod={officePeriodName}
          hasDays={days.length > 0}
          onPick={(next) => {
            setPick(next);
            setResultNote(null);
          }}
        />
      )}

      {stage === "home" && pick && pick.want !== "ilji" && (
        <PeriodReport
          key={pickedLine(pick)}
          days={days}
          dong={dongLabel ?? config.dong}
          unit={config.unit}
          officer={config.officer}
          weekForm={weeklyFormOf}
          periodForm={periodFormOf}
          onChanged={() => setLogVersion((n) => n + 1)}
          preset={pick}
          onOther={() => setPick(null)}
        />
      )}

      {stage === "home" && pick?.want === "ilji" && (
        <PickedBar line={pickedLine(pick)} hint="사진을 올리면 바로 나와요." onOther={() => setPick(null)} />
      )}

      {stage === "home" && pick && (
        <Home
          compact={pick.want !== "ilji"}
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
          onManual={(on) => {
            setManualPick(on);
            saveManual(on);
          }}
        />
      )}

      {stage === "calendar" && (
        <section className="space-y-3 rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
          <p className="text-[12px]">
            <b>달력</b>
            <span className="tnum text-[11px] text-[var(--muted)]">
              {days.length > 0 ? ` · 일지를 남긴 날 ${days.length}일 · 날을 누르면 그날 글이 보이고 일지로 받을 수 있어요` : " · 아직 일지를 남긴 날이 없어요"}
            </span>
          </p>
          <DayCalendar days={days} picked={pickedDay} onPick={setPickedDay} />
        </section>
      )}

      {stage === "calendar" && pastRecord && (
        <>
          <PastDay
            record={pastRecord}
            onCopy={() => {
              navigator.clipboard?.writeText(pastRecord.report).catch(() => undefined);
            }}
            onDelete={() => {
              // 잘못 만든 날을 담당자가 지운다. 글·자리 목록(localStorage)과 사진 사본(IndexedDB) 둘 다. 이 기기 안의 일이다.
              removeDay(pastRecord.date);
              void deletePhotos(pastRecord.date);
              setPickedDay(null);
              setLogVersion((n) => n + 1);
            }}
          />
          <DayForms date={pastRecord.date} office={officeIljiName} busy={pastBusy} note={pastNote} onGet={(form) => void getPast(form)} />
        </>
      )}

      {(stage === "field" || stage === "report") && photos.length > 0 && (
        <>
          {phase === "done" && pick && pick.want !== "ilji" && groups.length > 0 && (
            <>
              {shifted.note && <p className="text-[11.5px] text-[var(--muted)]">{shifted.note}</p>}
              <PeriodReport
                key={pickedLine(shifted.pick ?? pick)}
                days={days}
                dong={dongLabel ?? config.dong}
                unit={config.unit}
                officer={config.officer}
                weekForm={weeklyFormOf}
                periodForm={periodFormOf}
                onChanged={() => setLogVersion((n) => n + 1)}
                preset={shifted.pick ?? pick}
                onOther={() => {
                  setPick(null);
                  setStage("home");
                }}
              />
            </>
          )}
          {phase === "done" && pick?.want === "ilji" && groups.length > 0 && (
            <ResultCard
              line={pickedLine(pick)}
              spots={groups.length}
              busy={resultBusy || busy}
              note={resultNote}
              onGet={() => void getResult()}
              // 고른 양식의 반대쪽도 한 단추로. 부서 양식이 아직 없으면 올리는 자리로 데려간다.
              alt={
                pick.form === "office"
                  ? { label: "기본 양식 받기", onGet: () => void getResult("basic") }
                  : { label: "부서 양식 받기", office: true, onGet: getOffice }
              }
              onDetail={() => openReport()}
              onOther={() => {
                setPick(null);
                setStage("home");
              }}
            />
          )}
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
              genModel={ready.eye ?? "사진 읽기"}
              jevModel={firstPassName}
            />
            {busy && (
              <p className="text-[11px] text-[var(--muted)]">
                {phase === "prepare" &&
                  (opening.total > 0 ? `사진을 줄이는 중  ${opening.done}/${opening.total}` : "사진을 줄이는 중…")}
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
                : "찍힌 시각을 모르는 사진은 맨 뒤에 따로 두었습니다(점선 테두리). 자리가 어긋나 보이면 합치거나 나눠 주세요."}
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
                  defaultWork={defaultWorkOf(group, { ...DEFAULT_WORDING, ...wording })}
                  onAddress={(address) =>
                    touch(group.id, (g) => {
                      const next = { ...g, address };
                      // 지난번에 이 자리에 적어 둔 말이 있으면 얹는다. **비어 있을 때만**.
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
                  moving={moving}
                  onMoveStart={() => startMove(group.id)}
                  onMovePick={togglePick}
                  onMoveHere={() => moveTo(group.id)}
                  onRemove={() => removeGroup(group.id)}
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
                  onAddress={(address) => touch(group.id, (g) => ({ ...g, address, gpsMeters: undefined }))}
                  onWork={(work) => {
                    touch(group.id, (g) => ({ ...g, work }));
                    // 그 자리에 적을 말을 기억한다. 다음에 같은 자리면 그대로 얹는다.
                    if (group.address.trim()) learnWork(group.address, work);
                  }}
                  phrases={phrases}
                  defaultWork={defaultWorkOf(group, { ...DEFAULT_WORDING, ...wording })}
                  onMergeUp={() => mergeUp(group.id)}
                  onSplitAt={(photoIndex) => splitAt(group.id, photoIndex)}
                  moving={moving}
                  onMoveStart={() => startMove(group.id)}
                  onMovePick={togglePick}
                  onMoveHere={() => moveTo(group.id)}
                  onRemove={() => removeGroup(group.id)}
                  pick={pickById.get(group.id) ?? null}
                  onRole={(photoIndex, role) => setRole(group.id, photoIndex, role)}
                />
              ))}
              <AddMore onFiles={take} busy={busy} />
            </section>
          )}

          {/* 옮기는 동안 바닥에 붙는 띠. 무엇을 골랐고 다음에 무엇을 누르는지. */}
          {moving && stage === "field" && (
            <div
              className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 px-4 py-3 text-[12px]"
              style={{ background: "var(--paper)", borderTop: "1px solid var(--line)" }}
            >
              <span className="flex-1">
                옮기기 · 사진 <b>{moving.picked.length}장</b> 선택. 원본 자리의 사진을 눌러 고르고, 옮겨 넣을 자리의 <b>「N번 여기로」</b>를 누르세요.
              </span>
              <button
                type="button"
                onClick={() => moveTo(null)}
                disabled={moving.picked.length === 0}
                className="rounded-md px-3 py-1.5"
                style={{ border: "1px solid var(--line)", opacity: moving.picked.length === 0 ? 0.5 : 1 }}
              >
                새 자리로
              </button>
              <button type="button" onClick={() => setMoving(null)} className="rounded-md px-3 py-1.5" style={{ border: "1px solid var(--line)" }}>
                취소
              </button>
            </div>
          )}

          {stage === "report" && (
            <div ref={reportRef} className="flex flex-col gap-4 scroll-mt-4">
              {/* 이 회차에 모델이 한 것 · 코드가 한 것 · 사람이 한 것. 일지 바로 위에 붙어 받는 사람도 같이 본다. */}
              <WorkLine
                head="이 회차에 도구가 한 일"
                work={{
                  calls: Object.keys(described).length + Object.keys(judged).length,
                  learned: groups.filter((group) => group.learned).length,
                  unknown: groups.filter((group) => group.lane === "unknown").length,
                  edits,
                }}
              />
              <div ref={formRef} className="scroll-mt-4">
                <ReportExtras
                  collect={collectSlots}
                  date={date}
                  onFilled={() => {
                    // 부서 양식 파일로 받아 갔으면 복사한 것과 같다. 회차가 끝난 것으로 센다.
                    setCopied(true);
                    setLogVersion((n) => n + 1);
                  }}
                />
              </div>
              <ReportView
                secondary={officeIljiName !== null}
                report={report}
                text={reportText}
                edited={editedReport !== null || Object.keys(wording).length > 0}
                onCopy={() => {
                  setCopied(true);
                }}
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
                onHwpx={makeHwpx}
              />
              <AddMore onFiles={take} busy={busy} />
            </div>
          )}
        </>
      )}

      <Footer runs={runs} threads={config.threads} />
    </div>
  );
}

// ── 조각들 ────────────────────────────────────────────

/** 달력에서 고른 날을 일지 파일로. 부서 양식이 이 브라우저에 있으면 그것이 첫 단추, 기본 양식이 둘째. */
function DayForms({ date, office, busy, note, onGet }: { date: string; office: string | null; busy: boolean; note: string | null; onGet: (form: "office" | "basic") => void }) {
  // 그날 돌린 회차. 달력에서 연 뒤에만 그려지는 조각이라 브라우저 기록을 바로 읽어도 된다.
  const dayRuns = runsBetween(readRuns(), date, date);
  const dayWork = summarise(dayRuns);
  return (
    <section className="space-y-2 rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
      <p className="text-[12px]">
        <b>{date} 순찰일지 받기</b>
        <span className="text-[11px] text-[var(--muted)]"> · 그날 글과 사진 그대로</span>
      </p>
      {dayRuns.length > 0 && (
        <WorkLine
          head="그날 도구가 한 일"
          runs={dayRuns}
          work={{ calls: dayWork.modelCalls, learned: dayWork.learnedLanes, unknown: dayWork.unknownLanes, edits: dayWork.edits }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {office && (
          <button type="button" onClick={() => onGet("office")} disabled={busy} className="rounded-full px-4 py-2 text-[12.5px] font-semibold" style={{ background: "var(--ink)", color: "var(--paper)", opacity: busy ? 0.5 : 1 }} title={office}>
            <span className="iri-text">{busy ? "만드는 중" : "부서 양식"}</span>
          </button>
        )}
        <button type="button" onClick={() => onGet("basic")} disabled={busy} className="rounded-full px-4 py-2 text-[12.5px] font-semibold" style={office ? { border: "1px solid var(--line)", opacity: busy ? 0.5 : 1 } : { background: "var(--ink)", color: "var(--paper)", opacity: busy ? 0.5 : 1 }}>
          {busy && !office ? "만드는 중" : "기본 양식"}
        </button>
      </div>
      {note && <p className="text-[11.5px]">{note}</p>}
    </section>
  );
}

/** 뽑기에서 고른 것 한 줄. 홈의 사진 자리 위에 붙는다. */
function PickedBar({ line, hint, onOther }: { line: string; hint: string; onOther?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-[12px]" style={{ border: "1px solid var(--line)" }}>
      <b>{line}</b>
      <span className="text-[var(--muted)]">{hint}</span>
      {onOther && (
        <button type="button" onClick={onOther} className="ml-auto text-[11.5px] text-[var(--muted)] underline underline-offset-2">
          다른 것 뽑기
        </button>
      )}
    </div>
  );
}

/**
 * 결과 카드. 회차가 끝나면 맨 위에 뜬다. 할 일은 「받기」 하나다.
 * 글을 보거나 고치는 일은 보고서 탭에 그대로 있다. 고르는 일은 홈에서 끝났다.
 */
function ResultCard({
  line,
  spots,
  busy,
  note,
  onGet,
  alt,
  onDetail,
  onOther,
}: {
  line: string;
  spots: number;
  busy: boolean;
  note: string | null;
  onGet: () => void;
  /** 고른 양식의 반대쪽(기본 ↔ 부서). 없으면 단추가 안 뜬다. */
  alt?: { label: string; office?: boolean; onGet: () => void } | null;
  onDetail: () => void;
  onOther: () => void;
}) {
  return (
    <section className="space-y-2 rounded-xl p-3" style={{ border: "1px solid var(--ink)" }}>
      <p className="text-[13px]">
        <b>{line}</b>
        <span className="tnum text-[var(--muted)]"> · 준비됐어요 · 자리 {spots}곳</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onGet} disabled={busy} className="rounded-full px-5 py-2.5 text-[13px] font-semibold" style={{ background: "var(--ink)", color: "var(--paper)", opacity: busy ? 0.5 : 1 }}>
          {busy ? "만드는 중" : `${line} 받기`}
        </button>
        {alt && (
          <button type="button" onClick={alt.onGet} disabled={busy} className="rounded-full px-4 py-2 text-[12.5px] font-semibold" style={{ border: "1px solid var(--line)", opacity: busy ? 0.5 : 1 }}>
            {/* 부서 양식 글자만 Jev 빛. 달력의 「부서 양식」 단추와 같은 결. */}
            <span className={alt.office ? "iri-text" : ""}>{alt.label}</span>
          </button>
        )}
        <button type="button" onClick={onDetail} className="rounded-full px-3 py-2 text-[12px]" style={{ border: "1px solid var(--line)" }}>
          글 보기 · 고치기
        </button>
        <button type="button" onClick={onOther} className="text-[11.5px] text-[var(--muted)] underline underline-offset-2">
          다른 것 뽑기
        </button>
      </div>
      {note && <p className="text-[11.5px]">{note}</p>}
    </section>
  );
}

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
  ready: { vision: boolean; eye: string | null; firstPass: boolean };
  mode: Mode;
  runs: number;
}) {
  const tabs: Array<[Stage, string]> = [
    ["home", "홈"],
    ["field", "현장"],
    ["report", "보고서"],
    ["calendar", "달력"],
  ];

  return (
    <header className="flex flex-wrap items-center gap-3">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight">
          {unit} <span className="text-[var(--muted)]">· {dong}</span>
        </h1>
        <p className="text-[11px] text-[var(--muted)]">사진을 올리면 순찰일지 글이 나옵니다.</p>
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
            <Dot ok={ready.vision} label={ready.eye ?? "사진 읽기"} />
            <Dot ok={ready.firstPass} label="Jev" iri />
          </>
        )}
        <Mark />
        {runs > 0 && <span className="tnum">· 지금까지 {runs}회</span>}
      </div>
    </header>
  );
}

/** 이 도구의 표식. 옆의 점들과 같은 줄, 같은 크기. 카메라 하나에 PJ. */
function Mark() {
  return (
    <span className="inline-flex items-center gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={11} height={11} className="h-[11px] w-[11px] rounded-[2px]" />
      PJ
    </span>
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
  onManual,
  compact = false,
  compactHint = "기록이 없거나 오늘 것을 더하려면 그 날 사진을 올려요. 끝나면 위의 보고서가 바로 나와요.",
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
  ready: { vision: boolean; eye: string | null; firstPass: boolean };
  quota: { limit: number; left: number | null };
  mode: Mode;
  /** 오늘 맛보기 몫을 다 썼나. 그래서 직접 적는 길로 열린 것인지 화면이 말해 준다. */
  quotaSpent: boolean;
  dong: string | null;
  onDong: (name: string | null, choice: DongChoice | null) => void;
  /** 「수동」 단추를 눌렀을 때. 켜면 사진을 모델로 보내지 않는다. */
  onManual: (on: boolean) => void;
  /** 보고서 · 주간 일지 길의 작은 꼴. 사진 자리를 낮게 하고 설명 칸을 뺀다. 위의 「받기」와 한 눈에 들어오게. */
  compact?: boolean;
  /** 작은 꼴의 둘째 줄. 위에 무엇이 차오르는지(보고서 · 위험 일지)를 말한다. */
  compactHint?: string;
}) {
  const [over, setOver] = useState(false);
  // 겹 속으로 사진이 한 장 떠날 때마다 하나씩 올라간다. 사진기 표식이 그 값으로 「찰칵」을 다시 튼다.
  const [shot, setShot] = useState(0);
  const onShot = useCallback(() => setShot((n) => n + 1), []);

  return (
    <section className="space-y-3">
      <DongPicker
        value={dong}
        onChange={onDong}
        disabled={busy}
        trailing={
          // 입력칸과 같은 모양, 같은 색. 켜지면 글자만 진해진다.
          // 키가 없거나 오늘 몫을 다 써서 수동인 때에는 끌 수 없다. 그때는 눌러도 읽을 수가 없다.
          <button
            type="button"
            aria-pressed={mode === "manual"}
            disabled={busy || !ready.vision || quotaSpent}
            onClick={() => onManual(mode !== "manual")}
            title={
              mode === "manual"
                ? "사진을 모델로 보내지 않고 직접 적는 중입니다."
                : "누르면 사진을 모델로 보내지 않고 직접 적습니다."
            }
            className="shrink-0 rounded-md px-2 py-1 text-[12px]"
            style={{
              background: "var(--wash)",
              border: "1px solid var(--line)",
              color: mode === "manual" ? "var(--ink)" : "var(--muted)",
            }}
          >
            {mode === "manual" ? "수동 모드" : "수동 전환"}
          </button>
        }
      />

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
        <div className="space-y-0.5 text-[11.5px] text-[var(--muted)]">
          {/* 장수는 서버가 준 값(demoLimit, 공개 천장 10)을 그대로 적는다. 화면이 숫자를 지어내지 않게. */}
          <p>토큰량 증가로, 하루 {quota.limit}장으로 제한됩니다.</p>
          <p>
            제한 없이 쓰시려면{" "}
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
        </div>
      )}

      <label
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
          const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
          event.currentTarget.style.setProperty("--look-x", x.toFixed(3));
          event.currentTarget.style.setProperty("--look-y", y.toFixed(3));
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.setProperty("--look-x", "0");
          event.currentTarget.style.setProperty("--look-y", "0");
        }}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          onFiles([...event.dataTransfer.files].filter(isImageFile));
        }}
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl px-6 text-center ${compact ? "min-h-[88px] py-3" : "min-h-[260px] py-10"} ${over ? "iri-edge" : ""}`}
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
        {compact ? (
          <span className="flex items-center gap-2 text-[12.5px]">
            <CameraMark shot={shot} busy={over || busy} />
            <span className="text-left">
              <b>사진으로 일지 먼저 만들기</b>
              <br />
              <span className="text-[11.5px] text-[var(--muted)]">{compactHint}</span>
            </span>
          </span>
        ) : (
          <>
            <LayerStack active={over || busy} onShot={onShot} />
            {/* 표식은 겹 위에 떠 있다. 사진이 여기서 나와 겹을 지나 내려간다. */}
            <span className="relative z-10 -translate-y-[70px] drop-shadow-[0_6px_10px_rgba(0,0,0,0.12)]">
              <CameraMark shot={shot} busy={over || busy} />
            </span>
          </>
        )}
      </label>

      {!ready.vision && (
        <p className="text-[11.5px] text-[var(--muted)]">
          사진을 읽을 키(<b className="text-[var(--ink)]">ANTHROPIC_API_KEY</b> 또는 <b className="text-[var(--ink)]">OPENAI_API_KEY</b>)가 없어 사진을 글로 옮기지
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

      {!compact && (
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
      )}
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

function Footer({ runs, threads }: { runs: number; threads: string }) {
  const [open, setOpen] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const stats = open ? summarise(readRuns()) : null;

  /**
   * 회차마다 한 줄인 CSV 를 파일로 받는다. 측정표에 붙이는 길이다. 숫자와 시각뿐이다.
   * 앞에 BOM 을 둔다. 엑셀이 그게 없으면 한글을 깨뜨린다. 폰에서는 공유 창이 열린다.
   */
  const downloadCsv = () => downloadRunsCsv(readRuns());

  /** 같은 CSV 를 클립보드에. 파일 받기가 막힌 자리(앱 안 웹뷰)의 둘째 길. */
  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(runsCsv(readRuns()));
      setCopiedCsv(true);
      setTimeout(() => setCopiedCsv(false), 1500);
    } catch {
      // 클립보드가 막힌 브라우저에서는 조용히 넘어간다. 기록이 사라지는 것은 아니다.
    }
  };

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
        {" · "}
        {/* 이 도구의 이름. 스레드 글에서 온 사람이 다시 그 글로 돌아갈 수 있게 링크를 단다. 주소가 없으면 레포로. */}
        <a
          href={threads || "https://github.com/patrol-jev/patrol-jev"}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {/* 글줄 안에 그림을 놓는다. inline-flex 로 감싸면 그 덩이가 글줄 기준선을 벗어나 위로 뜬다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={11} height={11} className="mr-1 inline-block h-[11px] w-[11px] rounded-[2px] align-[-1.5px]" />
          PJ(patrol-jev)
        </a>
        {/* 이 판을 지은 때. 폰이 옛 코드를 쥐고 있는지 이 숫자 하나로 가린다. */}
        {process.env.NEXT_PUBLIC_BUILT_AT && (
          <span className="tnum">{` · 판 ${process.env.NEXT_PUBLIC_BUILT_AT}`}</span>
        )}
      </p>
      {stats && (
        <>
          <p className="tnum mt-1">
            {stats.runs}회 · {stats.photos}장 · 한 회차 중앙값 {stats.medianSeconds}초
            {stats.baselineMinutes !== null && ` · 도입 전 ${stats.baselineMinutes}분`}
          </p>
          {/* 모델이 한 것 · 코드가 한 것 · 사람이 한 것. 회차가 쌓이며 호출과 고침이 내려가고 기억이 오르는지를 이 줄에서 본다. */}
          <p className="tnum">
            모델에 물음 {stats.modelCalls} · 지난번 고친 대로 {stats.learnedLanes} · 모르겠음 {stats.unknownLanes} · 고친 횟수 {stats.edits}
            {stats.runs > 0 && (
              <>
                {" · "}
                <button onClick={downloadCsv} className="underline underline-offset-2">
                  CSV 받기
                </button>
                {" · "}
                <button onClick={() => void copyCsv()} className="underline underline-offset-2">
                  {copiedCsv ? "복사됨" : "복사"}
                </button>
              </>
            )}
          </p>
        </>
      )}
    </footer>
  );
}

// ── 잔심부름 ──────────────────────────────────────────

/** 열쇠가 있으면 같이 보낸다. 없으면 아무것도 안 붙는다. */
function passHeader(pass: string | null): Record<string, string> {
  return pass ? { "x-patrol-pass": pass } : {};
}

/**
 * 서버에 묻는다. 실패하면 **까닭이 든 오류**를 던진다. 화면은 그 말을 그대로 띄운다.
 *   · 브라우저가 서버에 못 닿음(인터넷 끊김) → 그렇다고 적는다.
 *   · 서버가 JSON 아닌 것을 돌려줌(앞단 502·재시작 중) → 서버가 응답하지 않는다고 적는다.
 *   · 서버가 error 를 적어 보냄(키·잔액·한도·연결) → 그 말을 그대로.
 */
async function post<T>(url: string, body: unknown, pass: string | null = null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...passHeader(pass) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      navigator.onLine === false
        ? "인터넷 연결이 끊겼습니다. 연결을 확인하고 다시 해 주세요. 올린 사진은 그대로 있습니다."
        : "서버에 닿지 못했습니다. 잠시 뒤에 다시 해 주세요. 올린 사진은 그대로 있습니다.",
    );
  }
  let payload: (T & { error?: string }) | null = null;
  try {
    payload = (await response.json()) as T & { error?: string };
  } catch {
    payload = null;
  }
  if (!response.ok || payload === null) {
    if (payload?.error) throw new Error(payload.error);
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new Error(`서버가 응답하지 않습니다(${response.status}). 다시 띄우는 중일 수 있습니다. 1분쯤 뒤에 다시 해 주세요.`);
    }
    if (response.status === 413) throw new Error("사진 한 장이 너무 큽니다(413). 사진을 줄여서 다시 올려 주세요.");
    throw new Error(`요청이 실패했습니다(${response.status}). 잠시 뒤에 다시 해 주세요.`);
  }
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
 * 대신 **덮었다는 것을 숨기지 않는다**. 카드에 「지난번 고친 대로」와 기계가 본 갈래를
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
 * 사진 칸의 표식. 글자 없이 이것 하나만 둔다. 무엇을 하는 칸인지 한눈에 보인다.
 *
 * 굵은 테두리에 주황 몸통. 도구의 표식이라 **Jev 무지개와는 색이 다르다**. 무지개는
 * 「Jev 가 낸 값」에만 쓰는 표시라, 표식이 그 자리를 빌려 쓰면 규칙이 흐려진다.
 * 테두리는 글자색을 따라가 밝은 화면에서도 어두운 화면에서도 읽힌다.
 *
 * 살아 있는 것처럼 움직인다(`globals.css` 의 `.cam-*`).
 *   · 겹과 같이 숨 쉬듯 뜬다
 *   · 렌즈 속 빛점이 손(마우스)을 따라본다
 *   · 이따금 눈을 깜빡인다(렌즈가 잠깐 좁아진다)
 *   · 사진 한 장이 겹 속으로 떠날 때 「찰칵」: 몸이 눌렸다 튀고, 번쩍이고, 움직임 선이 뻗는다
 *   · 사진을 끌어 오거나 읽는 동안에는 조금 더 빨리 뛴다
 * 움직임 줄이기를 켠 기기에서는 가만히 있다.
 */
function CameraMark({ shot = 0, busy = false }: { shot?: number; busy?: boolean }) {
  return (
    <span className={`cam-float ${busy ? "cam-busy" : ""}`}>
      {/* key 가 바뀌면 찰칵 움직임을 처음부터 다시 튼다. 첫 그림(0)에서는 안 튼다. */}
      <span key={shot} className={`cam-body ${shot > 0 ? "cam-shot" : ""}`}>
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          fill="none"
          role="img"
          aria-label="사진"
          style={{ color: "var(--ink)", overflow: "visible" }}
        >
          {/* 번쩍: 찰칵 때만 잠깐 */}
          <circle className="cam-flash" cx="40" cy="20.5" r="14" fill="#FFE2B8" />

          {/* 몸통. 각진 상자가 아니라 둥글고 도톰하게. */}
          <path
            d="M10 20c0-3.3 2.7-6 6-6h3.2c1.1 0 2.1-.6 2.6-1.5l1-1.8c.5-.9 1.5-1.5 2.6-1.5h5.2c1.1 0 2.1.6 2.6 1.5l1 1.8c.5.9 1.5 1.5 2.6 1.5H40c3.3 0 6 2.7 6 6v15c0 3.3-2.7 6-6 6H16c-3.3 0-6-2.7-6-6V20Z"
            fill="#F9871F"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinejoin="round"
          />

          {/* 렌즈. 깜빡일 때 세로로 잠깐 좁아진다. */}
          <g className="cam-lens">
            <circle cx="28" cy="28" r="8.4" fill="var(--paper)" stroke="currentColor" strokeWidth="2.6" />
            <circle className="cam-eye" cx="24.8" cy="24.8" r="1.9" fill="currentColor" opacity="0.85" />
          </g>

          {/* 플래시 */}
          <circle className="cam-bulb" cx="40" cy="20.5" r="1.7" fill="currentColor" />

          {/* 눌렀다는 기척. 캐릭터의 움직임 선에서 가져왔다. */}
          <path
            className="cam-lines"
            d="M5.5 16.5 3 13M50.5 16.5 53 13"
            stroke="#F9871F"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </span>
  );
}

/** 그 란이 기본으로 적는 말. 카드가 「비우면 이렇게 적힌다」를 보여 줄 때 쓴다. */
function defaultWorkOf(group: Pick<Group, "lane" | "shade">, say: Wording): string {
  if (group.lane === "risk_facility") return say.facilityWork;
  if (group.lane === "flood_season") return group.shade ? say.shadeWork : say.drainWork;
  return say.patrolWork;
}

/**
 * 아이폰 사진을 바꾸는 데 도구를 한 번 받는다. 몇 초 멈춰 있으면 사람은 고장인 줄 안다.
 * 무슨 일이 일어나는지 먼저 말해 둔다.
 */

/**
 * 읽은 주소판 가운데 고른 동의 도로명 색인에 **없는** 도로가 있는 쪽이 더 많은가.
 * 한 장은 오독일 수 있으니 둘 이상일 때만. 색인이 없거나 도로명을 못 짚은 장은 세지 않는다.
 */
function dongMismatch(items: Described[]): { read: number; unknown: number } | null {
  const read = items.filter((one) => one.roadKnown === true || one.roadKnown === false).length;
  const unknown = items.filter((one) => one.roadKnown === false).length;
  return unknown >= 2 && unknown * 2 > read ? { read, unknown } : null;
}

/**
 * 못 연 사진을 사람 말로. **이름을 적는다**. 「2장 실패」만으로는 어느 것인지 알 수 없어
 * 다시 올려 볼 수도, 빼고 갈 수도 없다.
 */
function failedNote(failed: FailedPhoto[]): string {
  const names = failed.slice(0, 3).map((one) => one.name).join(" · ");
  const more = failed.length > 3 ? ` 외 ${failed.length - 3}장` : "";
  return `${failed.length}장은 열지 못해 건너뜁니다 (${names}${more}). ${failed[0].why}`;
}

/**
 * 찍힌 시각을 못 읽은 사진이 있으면 한 번 알린다. 없으면 null.
 * 몇 장인지, 그리고 폰이 넘겨준 파일에 기록 흔적이 있었는지까지 적는다. 폰 사진첩에는
 * 시각이 보이는데 여기서 못 읽는 일이 있어서, 어디서 사라졌는지를 사람이 전해 줄 수 있게.
 */
function untimedToast(photos: PreparedPhoto[], willReadText: boolean): string | null {
  const untimed = photos.filter((photo) => photo.timeFrom === null).length;
  if (untimed === 0) return null;
  // 까닭(EXIF 자리·XMP·지문)은 photo.probe 에 남아 있다. 화면에는 안 적는다. 사람이 읽을 말이 아니다.
  // 이 시점은 파일 속 기록만 본 것이다. 사진 위에 찍힌 시각 글자는 사진→글 뒤에 읽으므로 「못 읽었다」고 단정하지 않는다.
  // 09-26 실물: 78장 전부 파일 기록이 없었지만 63장은 찍힌 글자로 시각을 되찾았는데, 이 문구가 「78장 못 읽음」이라고 적었다.
  // 직접 적기에서는 글자를 읽는 단계가 없다. 그때는 그렇게 말한다.
  const head = `${photos.length}장 가운데 ${untimed}장은 파일 속 촬영 시각 기록(EXIF)이 없습니다.`;
  return willReadText
    ? `${head} 사진 위에 찍힌 시각 글자는 다음 단계에서 읽습니다. 그것도 없는 장은 올라온 차례로 묶습니다(점선 테두리).`
    : `${head} 직접 적기는 사진 위 글자를 읽지 않으므로 올라온 차례로 묶습니다(점선 테두리).`;
}

/**
 * 시각을 어디서 얻었는지. 사진→글 뒤에 한 번 적고, 열 때의 「기록이 없다」 안내를 이 줄로 바꾼다.
 * 파일 속 기록(EXIF)과 사진 위에 찍힌 글자는 다른 것이다. 둘을 한 낱말로 부르면 「기록이 없다는데 시각이 찍혀 나온다」가 된다.
 */
function timeSourceNote(total: number, fromFile: number, fromText: number, borrowed: number, none: number): string {
  if (fromFile === total) return `시각: ${total}장 모두 파일 속 촬영 시각 기록(EXIF)에서 읽었습니다.`;
  const parts = [
    `파일 속 기록(EXIF) ${fromFile}장`,
    `사진 위에 찍힌 글자 ${fromText}장(섬네일에 「글자」)`,
    ...(borrowed > 0 ? [`옆 장에서 빌림 ${borrowed}장(「옆 장」)`] : []),
    ...(none > 0 ? [`없음 ${none}장(올라온 차례로 묶음, 점선 테두리)`] : []),
  ];
  const tail =
    fromText > 0
      ? " 파일에 기록이 없어도 사진 위에 찍힌 시각을 읽으면 일지에는 그 시각이 적힙니다."
      : "";
  return `시각 출처: ${parts.join(" · ")}.${tail}`;
}

/** 아래에 잠깐 떴다가 사라지는 알림. 누르면 바로 닫힌다. */
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 7000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <button
      type="button"
      onClick={onClose}
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-lg px-4 py-3 text-left text-[12px] leading-relaxed shadow-lg"
      style={{ background: "var(--ink)", color: "var(--paper)" }}
    >
      {text}
    </button>
  );
}

const subscribeNothing = () => () => {};
/** 다음 사진 번호. 검수에서 뺀 장이 있으면 번호에 빈 자리가 생기니 장수로 세지 않는다. */
function nextIndex(photos: PreparedPhoto[]): number {
  return photos.reduce((top, photo) => Math.max(top, photo.index + 1), 0);
}

const onClient = () => true;
const onServer = () => false;

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}
