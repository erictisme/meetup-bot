import { Client } from '@googlemaps/google-maps-services-js';

const client = new Client({});

export async function driveTimes(origin, destinations) {
  if (!origin || !destinations?.length) return [];
  const res = await client.distancematrix({
    params: {
      origins: [origin],
      destinations,
      mode: 'driving',
      key: process.env.GOOGLE_MAPS_API_KEY,
    },
    timeout: 8000,
  });

  const row = res.data.rows?.[0]?.elements || [];
  return row.map(el => {
    if (el.status !== 'OK') return null;
    return {
      seconds: el.duration.value,
      minutes: Math.round(el.duration.value / 60),
      text: el.duration.text,
    };
  });
}
