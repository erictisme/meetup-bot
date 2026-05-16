import { readFile } from 'node:fs/promises';
import { Client } from '@googlemaps/google-maps-services-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUser } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({});

const DEFAULT_PREFS = {
  cuisines: ['cafe', 'asian'],
  min_rating: 4.0,
};

async function loadCurated() {
  try {
    const full = path.join(__dirname, '..', 'config/venues.json');
    return JSON.parse(await readFile(full, 'utf8'));
  } catch {
    return [];
  }
}

export async function getCandidates({ midpoint, chatId, radius }) {
  const curated = await loadCurated();
  if (curated.length > 0) {
    return curated.map((v) => ({
      name: v.name,
      address: v.address,
      lat: v.lat,
      lng: v.lng,
      rating: v.rating,
      source: 'curated',
    }));
  }

  let prefs = DEFAULT_PREFS;
  if (chatId) {
    const user = await getUser(chatId);
    if (user?.prefs) prefs = { ...DEFAULT_PREFS, ...user.prefs };
  }

  const res = await client.placesNearby({
    params: {
      location: { lat: midpoint.lat, lng: midpoint.lng },
      radius: radius || 3000,
      type: 'cafe',
      key: process.env.GOOGLE_MAPS_API_KEY,
    },
    timeout: 8000,
  });

  const min = prefs.min_rating ?? 4.0;
  const places = (res.data.results || [])
    .filter((p) => (p.rating || 0) >= min)
    .filter((p) => !p.permanently_closed)
    .slice(0, 10);

  return places.map((p) => ({
    name: p.name,
    address: p.vicinity,
    lat: p.geometry?.location?.lat,
    lng: p.geometry?.location?.lng,
    rating: p.rating,
    source: 'places',
  }));
}
