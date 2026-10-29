import { useEffect } from 'react';
import { ScheduledTime } from '../../../shared/types';
import './SchedulePopup.css';

interface SchedulePopupProps {
  scheduledTimes: ScheduledTime[];
  classTimezone: string;
  now: Date;
  onClose: () => void;
  // Backdrop dismissal handlers from useOverlayDismiss.
  overlayProps: React.HTMLAttributes<HTMLDivElement>;
}

const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Wall-clock date and time of `date` in `timeZone`.
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

// How far `timeZone` is ahead of UTC at `date`, in milliseconds.
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The moment that is `time` (HH:MM) today, as the clock in `timeZone` reads it.
function classTimeToday(time: string, timeZone: string, now: Date): Date {
  const [hours, minutes] = time.split(':').map(Number);
  const today = zonedParts(now, timeZone);
  const wallClock = Date.UTC(today.year, today.month - 1, today.day, hours || 0, minutes || 0);
  // The offset depends on the moment, so check again in case a DST change
  // falls between now and that time.
  let offset = zoneOffsetMs(new Date(wallClock), timeZone);
  const corrected = zoneOffsetMs(new Date(wallClock - offset), timeZone);
  if (corrected !== offset) offset = corrected;
  return new Date(wallClock - offset);
}

function formatClock(date: Date, timeZone: string): string {
  return date.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
}

// "10:30–10:45 AM", or "11:45 AM–12:00 PM" when the range crosses noon.
function formatRange(start: Date, end: Date, timeZone: string): string {
  if (end.getTime() === start.getTime()) return formatClock(start, timeZone);
  const [startTime, startPeriod] = formatClock(start, timeZone).split(' ');
  const endText = formatClock(end, timeZone);
  return endText.endsWith(startPeriod) ? `${startTime}–${endText}` : `${startTime} ${startPeriod}–${endText}`;
}

// "+1 day" / "-1 day" when `date` falls on a different calendar day locally
// than it does in the class timezone (e.g. class in New York, laptop in Tokyo).
function dayShift(date: Date, classTimezone: string): string {
  const c = zonedParts(date, classTimezone);
  const l = zonedParts(date, LOCAL_TIMEZONE);
  const days = Math.round((Date.UTC(l.year, l.month - 1, l.day) - Date.UTC(c.year, c.month - 1, c.day)) / 86400000);
  if (days === 0) return '';
  return days > 0 ? `+${days} day` : `${days} day`;
}

function timezoneAbbr(timeZone: string): string {
  return (
    new Date().toLocaleTimeString('en-US', { timeZone, timeZoneName: 'short' }).split(' ').pop() ||
    timeZone.split('/').pop()?.replace(/_/g, ' ') ||
    timeZone
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function SchedulePopup({ scheduledTimes, classTimezone, now, onClose, overlayProps }: SchedulePopupProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sameZone = zoneOffsetMs(now, classTimezone) === zoneOffsetMs(now, LOCAL_TIMEZONE);

  const rows = scheduledTimes
    .filter((st) => st.enabled)
    .map((st) => {
      const start = classTimeToday(st.time, classTimezone, now);
      const end = new Date(start.getTime() + (st.duration || 0) * 60000);
      return { st, start, end };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const nowMs = now.getTime();
  const currentId = rows.find((r) => r.start.getTime() <= nowMs && nowMs < r.end.getTime())?.st.id;
  const nextId = rows.find((r) => r.start.getTime() > nowMs)?.st.id;

  return (
    <div className="lab-popup-overlay lab-popup-overlay--top-anchored" {...overlayProps}>
      <div className="lab-popup schedule-popup" onClick={(e) => e.stopPropagation()}>
        <div className="lab-popup-header">
          <span className="lab-popup-title">TODAY'S SCHEDULE</span>
          <button className="btn btn--small btn--danger" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="lab-popup-content">
          <div className="schedule-zones">
            <div>
              <span className="lab-popup-label">CLASS</span> {classTimezone.replace(/_/g, ' ')} ({timezoneAbbr(classTimezone)}) ·{' '}
              {formatClock(now, classTimezone)}
            </div>
            <div>
              <span className="lab-popup-label">LOCAL</span> {LOCAL_TIMEZONE.replace(/_/g, ' ')} ({timezoneAbbr(LOCAL_TIMEZONE)}) ·{' '}
              {formatClock(now, LOCAL_TIMEZONE)}
            </div>
            {sameZone && <div className="schedule-note">This computer is on class time.</div>}
          </div>

          {rows.length === 0 ? (
            <div className="schedule-note">No scheduled times. Add them in Settings &gt; Schedule.</div>
          ) : (
            <table className="schedule-table">
              <thead>
                <tr>
                  <th />
                  <th>CLASS ({timezoneAbbr(classTimezone)})</th>
                  {!sameZone && <th>LOCAL ({timezoneAbbr(LOCAL_TIMEZONE)})</th>}
                  <th>LENGTH</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ st, start, end }) => {
                  const state =
                    st.id === currentId ? 'now' : st.id === nextId ? 'next' : end.getTime() <= nowMs ? 'past' : '';
                  const shift = dayShift(start, classTimezone);
                  return (
                    <tr key={st.id} className={state ? `schedule-row--${state}` : undefined}>
                      <td className="schedule-label">
                        {st.isBreak && <span title="Break">☕ </span>}
                        {st.label}
                        {state === 'now' && <span className="schedule-badge">NOW</span>}
                        {state === 'next' && <span className="schedule-badge">NEXT</span>}
                      </td>
                      <td>{formatRange(start, end, classTimezone)}</td>
                      {!sameZone && (
                        <td>
                          {formatRange(start, end, LOCAL_TIMEZONE)}
                          {shift && <span className="schedule-shift"> {shift}</span>}
                        </td>
                      )}
                      <td>{st.duration ? formatDuration(st.duration) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
