"use client";

import { useMemo, useState } from "react";
import type { DayRecord } from "@/ui/usage";

/**
 * 지난 날짜 보기.
 *
 * 순찰은 날마다 한 번이다. 그래서 달력이 목록보다 낫다. 어느 날 일지를 안 썼는지가 한눈에 보인다.
 * 기록은 **이 컴퓨터에만** 쌓이고, 사진은 담지 않는다(글만 남긴다).
 */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function DayCalendar({
  days,
  picked,
  onPick,
}: {
  days: DayRecord[];
  picked: string | null;
  onPick: (date: string | null) => void;
}) {
  const today = new Date();
  const latest = days.length > 0 ? days[days.length - 1].date : isoDate(today);
  const [cursor, setCursor] = useState(() => (picked ?? latest).slice(0, 7));

  const saved = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const cells = useMemo(() => monthCells(cursor), [cursor]);

  if (days.length === 0) {
    return (
      <p className="text-[11.5px] text-[var(--muted)]">
        아직 남은 기록이 없습니다. 사진을 올려 일지를 한 번 만들면 그날 날짜가 여기 남습니다.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor, -1))}
          className="rounded px-2 py-0.5 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          이전
        </button>
        <span className="tnum text-[12px]">{cursor.replace("-", "년 ")}월</span>
        <button
          type="button"
          onClick={() => setCursor(shiftMonth(cursor, 1))}
          className="rounded px-2 py-0.5 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          다음
        </button>

        {picked && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="ml-auto rounded px-2 py-0.5 text-[11px]"
            style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--muted)" }}
          >
            오늘 것 보기
          </button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((name) => (
          <span key={name} className="text-center text-[10px] text-[var(--muted)]">
            {name}
          </span>
        ))}

        {cells.map((date, position) => {
          if (!date) return <span key={`blank-${position}`} />;

          const record = saved.get(date);
          const chosen = picked === date;
          return (
            <button
              key={date}
              type="button"
              disabled={!record}
              onClick={() => onPick(date)}
              title={record ? `사진 ${record.photos}장 · 자리 ${record.groups}곳` : undefined}
              className="tnum rounded py-1 text-center text-[11px]"
              style={{
                background: chosen ? "var(--ink)" : record ? "var(--wash)" : "transparent",
                color: chosen ? "var(--paper)" : record ? "var(--ink)" : "var(--muted)",
                border: `1px solid ${record ? "var(--line)" : "transparent"}`,
                opacity: record ? 1 : 0.45,
              }}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        })}
      </div>

    </div>
  );
}

/** 지난 날짜의 일지. 읽기만 한다. 그날 사진은 남아 있지 않다. */
export function PastDay({ record, onCopy, onDelete }: { record: DayRecord; onCopy: () => void; onDelete: () => void }) {
  // 지우기는 두 번 누른다. 창(confirm)을 띄우지 않고 단추 글자가 바뀐다. 잘못 눌러도 한 번으로는 안 지워진다.
  const [arming, setArming] = useState(false);
  return (
    <section className="space-y-2 rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
      <header className="flex flex-wrap items-center gap-2">
        <b className="text-[13px]">{record.date}</b>
        <span className="text-[11px] text-[var(--muted)]">
          {record.dong ? `${record.dong} · ` : ""}사진 {record.photos}장 · 자리 {record.groups}곳
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="ml-auto rounded px-2 py-1 text-[12px]"
          style={{ background: "var(--wash)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          복사
        </button>
        <button
          type="button"
          onClick={() => {
            if (!arming) {
              setArming(true);
              return;
            }
            setArming(false);
            onDelete();
          }}
          onBlur={() => setArming(false)}
          className="rounded px-2 py-1 text-[12px]"
          style={arming ? { background: "var(--ink)", color: "var(--paper)" } : { background: "var(--wash)", border: "1px solid var(--line)", color: "var(--muted)" }}
          title="이 날의 일지 글·자리 목록·사진 사본을 이 기기에서 지웁니다"
        >
          {arming ? "한 번 더 누르면 지웁니다" : "이 날 지우기"}
        </button>
      </header>

      <pre
        className="overflow-auto whitespace-pre-wrap rounded-lg p-3 text-[12px] leading-relaxed"
        style={{ background: "var(--wash)", color: "var(--ink)" }}
      >
        {record.report}
      </pre>
    </section>
  );
}

function isoDate(value: Date): string {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  return `${value.getFullYear()}-${month}-${`${value.getDate()}`.padStart(2, "0")}`;
}

/** 그 달의 칸들. 1일이 무슨 요일인지에 따라 앞을 비운다. */
function monthCells(cursor: string): (string | null)[] {
  const [year, month] = cursor.split("-").map(Number);
  if (!year || !month) return [];

  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();

  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= lastDay; day++) {
    cells.push(`${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`);
  }
  return cells;
}

function shiftMonth(cursor: string, by: number): string {
  const [year, month] = cursor.split("-").map(Number);
  const moved = new Date(year, month - 1 + by, 1);
  return `${moved.getFullYear()}-${`${moved.getMonth() + 1}`.padStart(2, "0")}`;
}
