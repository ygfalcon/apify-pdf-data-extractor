// Form W-9 extraction from the text layer: fillable form values first, then flattened (printed) values.
const CLASSES = ['individual_sole_proprietor', 'c_corporation', 's_corporation', 'partnership', 'trust_estate', 'llc', 'other'];
const LABELS = [
  [/^individual\/sole proprietor/i, 'individual_sole_proprietor'], [/^c corporation/i, 'c_corporation'],
  [/^s corporation/i, 's_corporation'], [/^partnership/i, 'partnership'], [/^trust\/estate/i, 'trust_estate'],
  [/^llc/i, 'llc'], [/^other/i, 'other'],
];
const field = (value, source, confidence = 0.98) => (value ? { value, confidence, source } : null);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function fromFormFields(fields) {
  const get = (re) => clean(Object.entries(fields).find(([k]) => re.test(k))?.[1]);
  const out = {
    name: get(/f1_01\[/), business_name: get(/f1_02\[/), address: get(/f1_07\[/), city_state_zip: get(/f1_08\[/),
    llc_code: get(/f1_03\[/), ssn: [get(/f1_11\[/), get(/f1_12\[/), get(/f1_13\[/)].join(''), ein: [get(/f1_14\[/), get(/f1_15\[/)].join(''),
  };
  const box = Object.entries(fields).find(([k, v]) => /c1_1\[\d\]/.test(k) && v && v !== 'Off');
  out.tax_classification = box ? CLASSES[Number(box[0].match(/c1_1\[(\d)\]/)[1])] ?? null : null;
  return out;
}

function fromFlattened(lines) {
  const page1 = lines.filter((l) => l.page === 1).sort((a, b) => b.y - a.y);
  const idx = (re) => page1.findIndex((l) => re.test(l.text));
  const between = (startRe, endRe) => {
    const a = idx(startRe); const b = idx(endRe);
    if (a < 0 || b < 0 || b <= a) return '';
    return page1.slice(a + 1, b)
      .filter((l) => !/entity’s name on line 2|entity's name on line 2|^see$/i.test(l.text) && l.items[0].x < 120)
      .map((l) => clean(l.items.filter((i) => i.x < 380).map((i) => i.s).join(' '))).filter(Boolean).join(' ');
  };
  const out = {
    name: between(/^1 Name of entity/i, /^2 Business name/i),
    business_name: between(/^2 Business name/i, /^3a /i),
    address: between(/^5 Address/i, /^6 City/i),
    city_state_zip: between(/^6 City/i, /^7 List account/i),
  };
  const digitsNear = (labelRe) => {
    const i = idx(labelRe);
    if (i < 0) return '';
    const y = page1[i].y;
    return page1.filter((l) => l.y < y + 2 && l.y > y - 30)
      .flatMap((l) => l.items.filter((it) => it.x >= 415 && /^[\d\s–-]+$/.test(it.s)).map((it) => it.s)).join('').replace(/\D/g, '');
  };
  out.ssn = digitsNear(/^Social security number$/i);
  out.ein = digitsNear(/^Employer identification number$/i);
  out.tax_classification = null;
  for (const l of page1) {
    for (let k = 0; k < l.items.length - 1; k++) {
      const mark = l.items[k]; const next = l.items[k + 1];
      if (/^[4✓✔xX]$/.test(mark.s.trim()) && next.x - (mark.x + mark.w) < 16) {
        const hit = LABELS.find(([re]) => re.test(next.s.trim()));
        if (hit) out.tax_classification = hit[1];
      }
    }
  }
  return out;
}

export function analyzeW9(layer) {
  const hasForm = Object.keys(layer.fields || {}).some((k) => /f1_0[1-8]\[/.test(k));
  const raw = hasForm ? fromFormFields(layer.fields) : fromFlattened(layer.lines);
  const source = hasForm ? 'form_field' : 'text_layer';
  const ein = raw.ein && raw.ein.length === 9 ? `${raw.ein.slice(0, 2)}-${raw.ein.slice(2)}` : null;
  const ssnLast4 = raw.ssn && raw.ssn.length === 9 ? raw.ssn.slice(5) : null;
  const fields = {
    name: field(raw.name, source),
    business_name: field(raw.business_name, source),
    tax_classification: field(raw.tax_classification, source, 0.9),
    llc_tax_code: field(raw.llc_code, source),
    address: field(raw.address, source),
    city_state_zip: field(raw.city_state_zip, source),
    ein: field(ein, source),
    ssn_last4: field(ssnLast4, source),
  };
  const filled = Object.values(fields).filter(Boolean).length;
  if (!filled) return { fields, error: 'Blank W-9: no filled-in values found. Not charged.', blank: true };
  return { fields };
}
