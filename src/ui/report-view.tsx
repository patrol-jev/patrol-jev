"use client";

import { useState } from "react";
import type { Report } from "@/core/report";

/**
 * 산출은 여기까지다 — **복붙할 수 있는 글**.
 *
 * hwp 양식으로 뽑아 주지 않는다. 부서 양식은 동마다 다르고,
 * 남의 양식을 맞춰 주기 시작하면 이 도구는 아무도 못 고치는 물건이 된다.
 */
export function ReportView({
  report,
  text,
  onCopy,
  onEdit,
  onReset,
  edited,
}: {
  report: Report;
  /** 화면에 보이고 복사되는 글. 사람이 고쳤으면 고친 글이다. */
  text: string;
  onCopy: () => void;
  onEdit: (text: string) => void;
  onReset: () => void;
  edited: boolean;
}) {
  return (
    <div className="space-y-3">
      {report.undecided > 0 && (
        <p
          className="rounded-lg px-3 py-2 text-[12px]"
          style={{ background: "var(--wash)", color: "var(--muted)" }}
        >
          갈래가 안 정해진 묶음이 <b className="text-[var(--ink)]">{report.undecided}개</b> 있습니다.
          이 묶음은 아래 어느 란에도 들어가지 않았습니다. 「현장」에서 정해 주세요.
        </p>
      )}

      <CopyBlock
        title="전체"
        text={text}
        primary
        onCopied={onCopy}
        onEdit={onEdit}
        onReset={onReset}
        edited={edited}
      />

      <div className="grid gap-3 md:grid-cols-3">
        {report.blocks.map((block) => (
          <CopyBlock
            key={block.key}
            title={block.title}
            badge={`${block.count}건`}
            text={block.text}
            dim={block.count === 0}
            onCopied={onCopy}
          />
        ))}
      </div>
    </div>
  );
}

function CopyBlock({
  title,
  badge,
  text,
  primary,
  dim,
  onCopied,
  onEdit,
  onReset,
  edited,
}: {
  title: string;
  badge?: string;
  text: string;
  primary?: boolean;
  dim?: boolean;
  onCopied: () => void;
  /** 고칠 수 있는 글에만 준다. 고치면 문구를 기억한다. */
  onEdit?: (text: string) => void;
  onReset?: () => void;
  edited?: boolean;
}) {
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // 권한이 없으면 아래 글을 직접 긁어 가면 된다.
    }
    setDone(true);
    onCopied();
    setTimeout(() => setDone(false), 1400);
  }

  return (
    <section
      className="flex flex-col rounded-xl p-3"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--line)",
        opacity: dim ? 0.55 : 1,
      }}
    >
      <header className="flex items-center gap-2">
        <h3 className="text-[13px] font-medium">{title}</h3>
        {badge && <span className="tnum text-[11px] text-[var(--muted)]">{badge}</span>}
        {onEdit && !editing && (
          <button
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
            className="ml-auto rounded-md px-3 py-1.5 text-[12px]"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            수정
          </button>
        )}

        {onEdit && editing && (
          <>
            <button
              onClick={() => {
                onEdit(draft);
                setEditing(false);
              }}
              className="ml-auto rounded-md px-3 py-1.5 text-[12px] font-medium"
              style={{ background: "var(--ink)", color: "var(--paper)" }}
            >
              저장
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1.5 text-[12px]"
              style={{ border: "1px solid var(--line)", color: "var(--muted)" }}
            >
              그만두기
            </button>
          </>
        )}

        {onReset && edited && !editing && (
          <button
            onClick={onReset}
            className="rounded-md px-3 py-1.5 text-[12px]"
            style={{ border: "1px solid var(--line)", color: "var(--muted)" }}
          >
            처음 문구로
          </button>
        )}

        <button
          onClick={copy}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium${onEdit ? "" : " ml-auto"}`}
          style={
            primary
              ? { background: "var(--ink)", color: "var(--paper)" }
              : { border: "1px solid var(--line)", color: "var(--ink)" }
          }
        >
          {done ? "복사됨" : "복사"}
        </button>
      </header>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="tnum mt-2 min-h-64 flex-1 rounded-lg p-2.5 text-[11.5px] leading-relaxed"
            style={{ background: "var(--wash)", color: "var(--ink)", border: "1px solid var(--line)" }}
          />
          <p className="mt-1 text-[10.5px] text-[var(--muted)]">
            고친 말은 다음 회차에도 그대로 씁니다. 줄을 넣거나 지우면 그 회차에만 반영됩니다.
          </p>
        </>
      ) : (
        <pre
          className="mt-2 flex-1 overflow-x-auto rounded-lg p-2.5 text-[11.5px] leading-relaxed"
          style={{ background: "var(--wash)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {text}
        </pre>
      )}
    </section>
  );
}
