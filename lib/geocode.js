import { Client } from '@googlemaps/google-maps-services-js';

const client = new Client({});

export async function geocode(address) {
  const res = await client.geocode({
    params: { address, key: process.env.GOOGLE_MAPS_API_KEY },
    timeout: 8000,
  });
  const first = res.data.results?.[0];
  if (!first) return null;
  return {
    address: first.formatted_address,
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
  };
}
