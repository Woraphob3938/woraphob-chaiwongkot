"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search, Star, UsersRound } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { authenticatedRequest } from "@/lib/api";
import { formatDateTime, formatMoney, formatShortDay, initials } from "@/lib/format";
import type { BookingStatus } from "@/lib/types";

export type TrainerMemberSummary = {
  id: number;
  displayName: string;
  imageUrl: string | null;
  goals: string | null;
  experienceLevel: string | null;
  totalBookings: number;
  completedSessions: number;
  activeBookings: number;
  nextSessionAt: string | null;
  lastSessionAt: string | null;
  history: Array<{
    id: string;
    status: BookingStatus;
    bookingType: "single" | "monthly";
    sessionCount: number;
    startsAt: string;
    endsAt: string;
    quotedPrice: number | null;
  }>;
};

export type TrainerReviewSummary = {
  count: number;
  average: number | null;
  distribution: Record<string, number>;
  reviews: Array<{ id: number; rating: number; comment: string; createdAt: string; bookingId: string; memberName: string }>;
};

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await authenticatedRequest<T>(path));
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    let active = true;
    async function run() {
      if (!active) return;
      await load();
    }
    void run();
    return () => { active = false; };
  }, [load]);
  return { data, error, loading, reload: load };
}

function LoadError({ message, onRetry, busy }: { message: string; onRetry: () => void; busy: boolean }) {
  return (
    <div className="workbench-error" role="alert">
      <span>{message}</span>
      <button type="button" disabled={busy} onClick={onRetry}>
        <RefreshCw aria-hidden="true" size={15} /> {busy ? "กำลังโหลด…" : "ลองใหม่"}
      </button>
    </div>
  );
}


/** Members per page: two columns of five on a wide screen. */
const MEMBERS_PER_PAGE = 10;
/** Bookings shown in an opened member before "show all". */
const HISTORY_PREVIEW = 5;
const REVIEWS_PER_PAGE = 5;
/** A comment longer than this is clamped to three lines with "อ่านต่อ". */
const LONG_COMMENT = 160;

/** Page numbers around the current one, so a long list never prints fifty buttons. */
function pageWindow(page: number, pages: number): number[] {
  const first = Math.max(0, Math.min(page - 2, pages - 5));
  return Array.from({ length: Math.min(5, pages) }, (_, index) => first + index);
}

function ListPager({ page, pages, total, perPage, label, onChange }: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  label: string;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="trainer-list-pager" aria-label={label}>
      <span aria-live="polite">แสดง {page * perPage + 1}–{Math.min(total, (page + 1) * perPage)} จาก {total}</span>
      <div>
        <button type="button" aria-label="หน้าก่อนหน้า" disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft aria-hidden="true" size={16} /></button>
        {pageWindow(page, pages).map((index) => (
          <button type="button" key={index} aria-current={index === page ? "page" : undefined} aria-label={`หน้า ${index + 1}`} onClick={() => onChange(index)}>{index + 1}</button>
        ))}
        <button type="button" aria-label="หน้าถัดไป" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}><ChevronRight aria-hidden="true" size={16} /></button>
      </div>
    </nav>
  );
}

type MemberSort = "next" | "bookings" | "name";
const memberSortCopy: Record<MemberSort, string> = { next: "นัดใกล้สุด", bookings: "จองบ่อยสุด", name: "ชื่อ ก–ฮ" };

function sortMembers(list: TrainerMemberSummary[], sort: MemberSort) {
  const time = (value: string | null) => (value ? new Date(value).getTime() : Number.NaN);
  return list.slice().sort((left, right) => {
    if (sort === "name") return left.displayName.localeCompare(right.displayName, "th-TH");
    if (sort === "bookings") return right.totalBookings - left.totalBookings || left.displayName.localeCompare(right.displayName, "th-TH");
    // Members with a session coming up first, soonest on top; then the most
    // recently trained; then everyone else.
    const leftNext = time(left.nextSessionAt);
    const rightNext = time(right.nextSessionAt);
    if (!Number.isNaN(leftNext) || !Number.isNaN(rightNext)) {
      if (Number.isNaN(leftNext)) return 1;
      if (Number.isNaN(rightNext)) return -1;
      return leftNext - rightNext;
    }
    return (time(right.lastSessionAt) || 0) - (time(left.lastSessionAt) || 0);
  });
}

function MemberCard({ member }: { member: TrainerMemberSummary }) {
  const [showAll, setShowAll] = useState(false);
  const history = showAll ? member.history : member.history.slice(0, HISTORY_PREVIEW);
  const hidden = member.history.length - history.length;
  // The API sends at most the latest 20 bookings, so "all" is only claimed
  // when the history really is every booking the member made.
  const truncated = member.history.length < member.totalBookings;
  return (
    <li className="trainer-member-card">
      <details>
        <summary>
          <span className="trainer-member-card__avatar" aria-hidden="true">{initials(member.displayName)}</span>
          <span className="trainer-member-card__identity">
            <strong>{member.displayName}</strong>
            <small>
              {member.nextSessionAt
                ? `นัดถัดไป ${formatDateTime(member.nextSessionAt)}`
                : member.lastSessionAt
                  ? `ฝึกล่าสุด ${formatShortDay(member.lastSessionAt)}`
                  : "ยังไม่มีนัดที่ฝึกแล้ว"}
            </small>
          </span>
          <span className="trainer-member-card__stats">
            <span><strong>{member.totalBookings}</strong> การจอง</span>
            <span><strong>{member.completedSessions}</strong> ครั้งที่ฝึกแล้ว</span>
          </span>
        </summary>
        <div className="trainer-member-card__body">
          {member.goals && <p className="trainer-member-card__goal"><span>เป้าหมาย</span>{member.goals}</p>}
          <h3 className="sr-only">ประวัติการฝึกของ {member.displayName}</h3>
          <ol className="trainer-member-history" aria-label={`ประวัติการฝึกของ ${member.displayName}`}>
            {history.map((item) => (
              <li key={item.id}>
                <time dateTime={item.startsAt}>{formatDateTime(item.startsAt)}</time>
                <span>{item.bookingType === "monthly" ? `แพ็กเกจ ${item.sessionCount} ครั้ง` : "รายครั้ง"} · {formatMoney(item.quotedPrice ?? undefined)}</span>
                <StatusBadge status={item.status} />
              </li>
            ))}
          </ol>
          {(hidden > 0 || showAll) && member.history.length > HISTORY_PREVIEW && (
            <p className="trainer-member-history__more">
              <button type="button" className="trainer-review-list__more" onClick={() => setShowAll(!showAll)}>
                {showAll ? "แสดงเฉพาะล่าสุด" : truncated ? `ดู ${member.history.length} รายการล่าสุด` : `ดูประวัติทั้งหมด ${member.history.length} รายการ`}
              </button>
            </p>
          )}
          {showAll && truncated && (
            <p className="trainer-member-history__more">แสดง {member.history.length} รายการล่าสุดจากทั้งหมด {member.totalBookings} การจอง</p>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * บทที่ 3.1.3 ข้อ 6: members who booked or are booking with the trainer, and
 * each member's training history. The list pages itself so a trainer with a
 * hundred members still gets a short tab.
 */
export function TrainerMembersPanel() {
  const { data, error, loading, reload } = useLoad<TrainerMemberSummary[]>("/v1/trainer/members");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MemberSort>("next");
  const [page, setPage] = useState(0);
  const members = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    const normalized = query.trim().toLocaleLowerCase("th-TH");
    const filtered = normalized ? list.filter((member) => member.displayName.toLocaleLowerCase("th-TH").includes(normalized)) : list;
    return sortMembers(filtered, sort);
  }, [data, query, sort]);
  const total = Array.isArray(data) ? data.length : 0;
  const pages = Math.max(1, Math.ceil(members.length / MEMBERS_PER_PAGE));
  const currentPage = Math.min(page, pages - 1);
  const visible = members.slice(currentPage * MEMBERS_PER_PAGE, (currentPage + 1) * MEMBERS_PER_PAGE);

  return (
    <section className="trainer-finance trainer-members-panel" aria-labelledby="trainer-members-title">
      <header className="section-line-heading">
        <div>
          <h2 id="trainer-members-title">สมาชิกของฉัน</h2>
          <p>สมาชิกที่เคยจองหรือกำลังจอง แตะชื่อเพื่อดูประวัติการฝึก</p>
        </div>
        <span className="queue-count">{total} คน</span>
      </header>

      {total > 0 && (
        <div className="trainer-members__toolbar">
          <label className="chat-room-search trainer-members__search" htmlFor="trainer-members-search">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">ค้นหาสมาชิก</span>
            <input id="trainer-members-search" type="search" value={query} placeholder="ค้นหาชื่อสมาชิก" onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          </label>
          <div className="trainer-members__sort" role="group" aria-label="เรียงสมาชิก">
            {(Object.keys(memberSortCopy) as MemberSort[]).map((key) => (
              <button type="button" key={key} aria-pressed={sort === key} onClick={() => { setSort(key); setPage(0); }}>{memberSortCopy[key]}</button>
            ))}
          </div>
        </div>
      )}

      {loading && data === null && <p className="queue-loading" aria-live="polite">กำลังโหลดรายชื่อสมาชิก…</p>}
      {error && <LoadError message={error} busy={loading} onRetry={() => void reload()} />}
      {!loading && !error && total === 0 && (
        <div className="empty-state">
          <UsersRound aria-hidden="true" size={24} />
          <strong>ยังไม่มีสมาชิก</strong>
          <p>รายชื่อจะปรากฏเมื่อมีสมาชิกส่งคำขอจองครั้งแรก</p>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="trainer-member-list" aria-label="รายชื่อสมาชิก">
          {visible.map((member) => <MemberCard key={member.id} member={member} />)}
        </ul>
      )}
      {total > 0 && members.length === 0 && <p className="chat-room-list__empty" role="status">ไม่พบสมาชิกที่ตรงกับคำค้นหา</p>}
      <ListPager page={currentPage} pages={pages} total={members.length} perPage={MEMBERS_PER_PAGE} label="หน้ารายชื่อสมาชิก" onChange={setPage} />
    </section>
  );
}

function Stars({ value, label }: { value: number; label?: string }) {
  return (
    <span className="rating-stars" role="img" aria-label={label ?? `${value} จาก 5 ดาว`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <Star key={index} aria-hidden="true" size={15} className={index <= Math.round(value) ? "is-filled" : undefined} />
      ))}
    </span>
  );
}

function ReviewItem({ review }: { review: TrainerReviewSummary["reviews"][number] }) {
  const [expanded, setExpanded] = useState(false);
  const long = review.comment.length > LONG_COMMENT;
  return (
    <li className={expanded ? "is-expanded" : undefined}>
      <div className="trainer-review-list__head">
        <strong>{review.memberName}</strong>
        <Stars value={review.rating} />
      </div>
      <p>{review.comment}</p>
      {long && (
        <button type="button" className="trainer-review-list__more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "ย่อ" : "อ่านต่อ"}
        </button>
      )}
      <small>{formatShortDay(review.createdAt)} · {review.bookingId}</small>
    </li>
  );
}

/**
 * บทที่ 3.1.3 ข้อ 7: reviews from members and the average score. The score
 * sits beside the list, which filters by star and pages five at a time.
 */
export function TrainerReviewsPanel() {
  const { data, error, loading, reload } = useLoad<TrainerReviewSummary>("/v1/trainer/reviews");
  const [stars, setStars] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const count = data?.count ?? 0;
  const average = data?.average ?? null;
  const reviews = useMemo(() => {
    const list = data?.reviews ?? [];
    return stars === null ? list : list.filter((review) => Math.round(review.rating) === stars);
  }, [data, stars]);
  const pages = Math.max(1, Math.ceil(reviews.length / REVIEWS_PER_PAGE));
  const currentPage = Math.min(page, pages - 1);
  const visible = reviews.slice(currentPage * REVIEWS_PER_PAGE, (currentPage + 1) * REVIEWS_PER_PAGE);

  return (
    <section className="trainer-finance trainer-reviews-panel" aria-labelledby="trainer-reviews-title">
      <header className="section-line-heading">
        <div>
          <h2 id="trainer-reviews-title">รีวิวและคะแนน</h2>
          <p>ความคิดเห็นจากสมาชิกหลังการฝึก</p>
        </div>
        <span className="queue-count">{count} รีวิว</span>
      </header>

      {loading && data === null && <p className="queue-loading" aria-live="polite">กำลังโหลดรีวิว…</p>}
      {error && <LoadError message={error} busy={loading} onRetry={() => void reload()} />}

      {data && count === 0 && (
        <div className="empty-state"><strong>ยังไม่มีรีวิว</strong><p>สมาชิกเขียนรีวิวได้หลังคุณบันทึกผลการฝึกแล้ว</p></div>
      )}

      {data && count > 0 && (
        <div className="trainer-reviews__layout">
          <div className="trainer-reviews__summary">
            <div className="trainer-reviews__score">
              <strong>{average === null ? "–" : average.toFixed(1)}</strong>
              <Stars value={average ?? 0} label={average === null ? "ยังไม่มีคะแนน" : `คะแนนเฉลี่ย ${average.toFixed(1)} จาก 5`} />
              <small>คะแนนเฉลี่ยจาก {count} รีวิว</small>
            </div>
            <dl className="trainer-reviews__bars">
              {[5, 4, 3, 2, 1].map((star) => {
                const value = data.distribution?.[star] ?? 0;
                const percent = count > 0 ? Math.round((value / count) * 100) : 0;
                return (
                  <div key={star}>
                    <dt>{star} ดาว</dt>
                    <dd>
                      <span className="trainer-reviews__bar"><span style={{ width: `${percent}%` }} /></span>
                      <span>{value}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>

          <div className="trainer-reviews__main">
            <div className="trainer-reviews__filter" role="group" aria-label="กรองตามคะแนน">
              <button type="button" aria-pressed={stars === null} onClick={() => { setStars(null); setPage(0); }}>ทั้งหมด</button>
              {[5, 4, 3, 2, 1].map((star) => (
                <button type="button" key={star} aria-pressed={stars === star} disabled={(data.distribution?.[star] ?? 0) === 0} onClick={() => { setStars(star); setPage(0); }}>
                  {star} ดาว
                </button>
              ))}
            </div>
            {visible.length > 0 ? (
              <ul className="trainer-review-list" aria-label="รีวิวจากสมาชิก">
                {visible.map((review) => <ReviewItem key={review.id} review={review} />)}
              </ul>
            ) : (
              <p className="chat-room-list__empty" role="status">ไม่มีรีวิวที่ได้ {stars} ดาว</p>
            )}
            <ListPager page={currentPage} pages={pages} total={reviews.length} perPage={REVIEWS_PER_PAGE} label="หน้ารีวิว" onChange={setPage} />
          </div>
        </div>
      )}
    </section>
  );
}
