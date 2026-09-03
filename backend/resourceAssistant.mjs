import { GoogleGenAI } from '@google/genai';

// Resource assistant for the "Ask AI" tab.
//
//   free-text question
//     -> Gemini: pull out { keywords, location }
//     -> OpenStreetMap Nominatim: find real places
//     -> up to 5 clean result cards for the frontend
//
// Nothing about the results is hardcoded — they come straight from OSM.

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Where "near me" resolves to when the question names no place. Overridable
// with DEMO_LOCATION in backend/.env.
export const DEFAULT_LOCATION = process.env.DEMO_LOCATION || 'Vellore';

// When the default location is used we bias results to this country so a bare
// "Vellore" doesn't match the town of Vellore in Ontario, Canada.
const DEFAULT_COUNTRY = process.env.DEMO_COUNTRY_CODE || 'in';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Amara-Caregiving-App/1.0 (care-coordination demo)';

// --- 1. understand the question -------------------------------------------

// Very small dependency-free fallback if Gemini is unavailable.
function naiveKeywords(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/\b(where\s?('?s| is| are)?|what('?s| is)|the|nearest|closest|near\s?me|around|find|show|me|a|an|is|there|any|can|i|get|to|for|please|help)\b/g, ' ')
    .replace(/[?.!,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function parseQuery(message) {
  const prompt = `
You help a family caregiver find local services on a map. Turn their question
into a map search for a TYPE OF PLACE.

Question: """${String(message).trim()}"""

Return JSON only:
{
  "keywords": "<the type of place to search for>",
  "location": "<the town / area / city they mention, or '' if none>"
}

Rules for "keywords":
- It must name a kind of place that exists on a map: e.g. "pharmacy",
  "hospital", "clinic", "doctors", "dentist", "physiotherapist",
  "diagnostic lab", "medical store", "old age home", "taxi", "bus station".
- Map a described NEED to the nearest such place. Examples:
  "somewhere to get blood pressure checked" -> "clinic"
  "need my mother's insulin" -> "pharmacy"
  "blood test" -> "diagnostic lab"
  "a ride to the hospital" -> "taxi"
- 1-3 words. Never include the location or words like "near", "nearest", "24/7".`;

  try {
    const res = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    const parsed = JSON.parse(res.text);
    const keywords = String(parsed.keywords || '').trim();
    const location = String(parsed.location || '').trim();
    if (keywords) return { keywords, location };
  } catch (err) {
    console.warn('resourceAssistant: Gemini parse failed, using naive keywords –', err.message);
  }
  return { keywords: naiveKeywords(message), location: '' };
}

// --- 2. look up real places ----------------------------------------------

async function nominatimSearch(query, countryCode = null) {
  let url = `${NOMINATIM}?format=json&addressdetails=1&limit=8&q=${encodeURIComponent(query)}`;
  if (countryCode) url += `&countrycodes=${encodeURIComponent(countryCode)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  // Drop pure geography (city / postcode / boundary nodes) — never a "resource".
  const JUNK = new Set(['administrative', 'postcode', 'political', 'boundary', 'state', 'country', 'county', 'suburb', 'neighbourhood']);

  return rows
    .filter((r) => !JUNK.has(r.type) && r.class !== 'boundary' && r.class !== 'place')
    .slice(0, 5)
    .map((r) => {
    const lat = r.lat;
    const lon = r.lon;
    const label =
      r.name ||
      (r.display_name ? r.display_name.split(',')[0].trim() : '') ||
      'Unnamed place';
    return {
      name: label,
      address: r.display_name || '',
      lat,
      lon,
      kind: (r.type && r.type !== 'yes' ? r.type : r.class || '').replace(/_/g, ' '),
      // A neutral OSM link, plus a Google Maps one for phones that prefer it.
      mapUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
      gmapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    };
  });
}

// --- 3. the thing the route calls --------------------------------------

/**
 * @param {string} message  the user's typed question
 * @param {{ defaultLocation?: string }} [opts]
 * @returns {Promise<{
 *   results: Array, keywords: string, location: string,
 *   usedDefaultLocation: boolean, error?: string
 * }>}
 */
export async function findResources(message, opts = {}) {
  const defaultLocation = opts.defaultLocation || DEFAULT_LOCATION;
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    return { results: [], keywords: '', location: '', usedDefaultLocation: false };
  }

  const { keywords, location } = await parseQuery(trimmed);
  const kw = keywords || trimmed;
  const loc = location || defaultLocation;
  const usedDefaultLocation = !location;
  const cc = usedDefaultLocation ? DEFAULT_COUNTRY : null;

  // Nominatim is a geocoder, not a business directory — it does best with
  // "<amenity> <place>" (a space, not a comma) and no extra qualifiers. Try
  // the full phrase, then drop qualifier words ("24 hour physiotherapy" ->
  // "physiotherapy") before giving up.
  const headNoun = kw.split(/\s+/).slice(-1)[0]; // "24 hour pharmacy" -> "pharmacy"
  const attempts = [`${kw} ${loc}`];
  if (headNoun && headNoun.toLowerCase() !== kw.toLowerCase()) attempts.push(`${headNoun} ${loc}`);
  attempts.push(`${kw} near ${loc}`);

  try {
    let results = [];
    for (let i = 0; i < attempts.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max 1 req/sec
      results = await nominatimSearch(attempts[i], cc);
      if (results.length) break;
    }
    return { results, keywords: kw, location: loc, usedDefaultLocation };
  } catch (err) {
    console.error('resourceAssistant: lookup failed –', err.message);
    return { results: [], keywords: kw, location: loc, usedDefaultLocation, error: err.message };
  }
}
