// Daily course evaluation links.
//
// A course run has one eval per day. The links differ only in the D= query
// parameter (the day number), so the profile stores a single template link
// and each day's link is derived from that day's Day# setting. Deriving the
// link rather than storing N pasted links means a day can never be paired
// with another day's eval.

// Matches the D= parameter exactly (not e.g. EP= or a lowercase d=).
const DAY_PARAM = /([?&])D=[^&#]*/;

export interface EvalTemplateInfo {
  valid: boolean;
  error?: string;
  course?: string;
  templateDay?: string;
}

export function parseEvalTemplate(template: string): EvalTemplateInfo {
  const trimmed = template.trim();
  if (!trimmed) return { valid: false, error: 'No eval link set' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Not a valid URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { valid: false, error: 'Link must start with http:// or https://' };
  }
  if (!DAY_PARAM.test(trimmed)) {
    return { valid: false, error: 'Link has no D= (day) parameter' };
  }
  return {
    valid: true,
    course: url.searchParams.get('C') || undefined,
    templateDay: url.searchParams.get('D') || undefined,
  };
}

// Returns the eval link for the given day, or null if the template is unusable
// or the day has no Day# set. Only the D= value is replaced; the rest of the
// link is kept byte-for-byte so nothing else gets re-encoded.
export function buildEvalUrl(template: string | undefined, dayNumber: number | undefined): string | null {
  if (!template || !dayNumber || dayNumber < 1) return null;
  const trimmed = template.trim();
  if (!parseEvalTemplate(trimmed).valid) return null;
  return trimmed.replace(DAY_PARAM, `$1D=${dayNumber}`);
}
