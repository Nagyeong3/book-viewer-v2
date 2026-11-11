"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api, DocumentPolicy } from "../lib/api";

function entries(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean))).sort();
}

export default function DocumentAccessPanel() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [policies, setPolicies] = useState<DocumentPolicy[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [groupText, setGroupText] = useState("");
  const [userText, setUserText] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const locate = () => setTarget(document.querySelector<HTMLElement>(".topbar-actions"));
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await api.listDocumentPolicies();
      setPolicies(items);
      setSelectedId((current) => current != null && items.some((item) => item.document_id === current)
        ? current : (items[0]?.document_id ?? null));
    } catch {
      setError("문서 권한 정보를 불러오지 못했습니다. API 및 로그인 상태를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const selected = useMemo(() => policies.find((item) => item.document_id === selectedId) ?? null, [policies, selectedId]);
  const filtered = useMemo(() => policies.filter((item) =>
    item.title.toLowerCase().includes(query.trim().toLowerCase()) || String(item.document_id).includes(query.trim())
  ), [policies, query]);

  useEffect(() => {
    setGroupText(selected?.groups.join("\n") ?? "");
    setUserText(selected?.users.join("\n") ?? "");
    setNotice("");
  }, [selectedId, selected?.groups, selected?.users]);

  const groups = entries(groupText);
  const users = entries(userText);
  const changed = Boolean(selected) && (JSON.stringify(groups) !== JSON.stringify(selected?.groups)
    || JSON.stringify(users) !== JSON.stringify(selected?.users));

  async function save() {
    if (!selected || saving || !changed) return;
    if (groups.some((group) => !group.startsWith("/"))) {
      setError("그룹은 /teams/... 형식의 Keycloak 전체 경로로 입력하세요.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updated = await api.saveDocumentPolicy(selected.document_id, { groups, users });
      setPolicies((current) => current.map((item) => item.document_id === updated.document_id ? updated : item));
      setNotice("접근 권한이 저장되었습니다. 문서 목록을 다시 불러오면 변경 내용이 적용됩니다.");
      window.dispatchEvent(new Event("book-viewer:document-access-changed"));
    } catch {
      setError("접근 권한 저장에 실패했습니다. 관리자 권한과 DB 설정을 확인하세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {target ? createPortal(
        <button type="button" className="document-access-launch" onClick={() => setOpen(true)} title="사용자·그룹별 문서 접근 권한 관리">
          <span aria-hidden="true">▤</span><span>문서 권한관리</span>
        </button>, target
      ) : null}
      {open ? (
        <div className="document-access-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target && !saving) setOpen(false);
        }}>
          <section className="document-access-dialog" role="dialog" aria-modal="true" aria-labelledby="document-access-title">
            <header className="document-access-header">
              <div><small>ADMIN · ACCESS CONTROL</small><h2 id="document-access-title">문서 접근 권한 관리</h2>
                <p>사용자·그룹에 허용할 문서를 지정합니다. 별도 허용이 없으면 일반 사용자는 접근할 수 없습니다.</p></div>
              <button type="button" className="document-access-close" onClick={() => setOpen(false)} disabled={saving} aria-label="닫기">×</button>
            </header>
            <div className="document-access-body">
              <aside className="document-access-library">
                <label htmlFor="document-access-search">기술문서 선택 <span>{policies.length}건</span></label>
                <input id="document-access-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="문서명 또는 ID 검색"/>
                <div className="document-access-list">
                  {filtered.map((item) => (
                    <button key={item.document_id} type="button"
                      className={selectedId === item.document_id ? "selected" : ""}
                      onClick={() => {
                        if (changed && !window.confirm("저장하지 않은 변경사항이 있습니다. 다른 문서로 이동할까요?")) return;
                        setSelectedId(item.document_id); setError("");
                      }}>
                      <strong title={item.title}>{item.title}</strong>
                      <small>#{item.document_id} · 그룹 {item.groups.length} · 개인 {item.users.length}</small>
                    </button>
                  ))}
                  {!loading && !filtered.length ? <p className="document-access-empty">표시할 문서가 없습니다.</p> : null}
                  {loading ? <p className="document-access-empty">불러오는 중...</p> : null}
                </div>
              </aside>
              <div className="document-access-editor">
                {selected ? <>
                  <div className="document-access-selected"><small>선택 문서 · #{selected.document_id}</small><strong>{selected.title}</strong></div>
                  <label htmlFor="document-access-groups">접근 허용 그룹</label>
                  <p>Keycloak 그룹 전체 경로를 한 줄에 하나씩 입력하세요.</p>
                  <textarea id="document-access-groups" value={groupText} onChange={(event) => setGroupText(event.target.value)}
                    placeholder={"/teams/ips-260703-test\n/teams/example-group"} rows={4}/>
                  <label htmlFor="document-access-users">추가 허용 사용자</label>
                  <p>사용자명 대신 Keycloak 사용자 고유 ID(sub)를 사용합니다.</p>
                  <textarea id="document-access-users" value={userText} onChange={(event) => setUserText(event.target.value)}
                    placeholder="Keycloak 사용자 ID (한 줄에 하나)" rows={4}/>
                  <div className="document-access-policy">
                    <strong>현재 입력된 허용 대상</strong>
                    <span>그룹 {groups.length}개 · 사용자 {users.length}명</span>
                    <small>관리자는 위 목록과 관계없이 전체 문서에 접근할 수 있습니다.</small>
                  </div>
                </> : <div className="document-access-placeholder">권한을 설정할 문서를 선택하세요.</div>}
              </div>
            </div>
            <footer className="document-access-footer">
              <div aria-live="polite">{error ? <span className="document-access-error">{error}</span>
                : notice ? <span className="document-access-success">{notice}</span>
                : <span>권한 변경은 저장 시 적용됩니다.</span>}</div>
              <button type="button" className="document-access-cancel" onClick={() => setOpen(false)} disabled={saving}>닫기</button>
              <button type="button" className="document-access-save" onClick={() => void save()} disabled={!changed || saving || !selected}>
                {saving ? "저장 중..." : "권한 저장"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
