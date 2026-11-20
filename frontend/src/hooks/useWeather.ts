import { useCallback, useEffect, useState } from 'react';

export type WeatherCategory =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm';

export interface WeatherData {
  city: string;
  country: string;
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  windKmh: number;
  code: number;
  condition: string;
  category: WeatherCategory;
  isDay: boolean;
  updatedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_PREFIX = 'constellation.weather.cache.v1:';

function mapWmoCode(code: number): { condition: string; category: WeatherCategory } {
  if (code === 0) return { condition: 'Clear Sky', category: 'clear' };
  if (code <= 2) return { condition: 'Partly Cloudy', category: 'partly-cloudy' };
  if (code === 3) return { condition: 'Overcast', category: 'cloudy' };
  if (code === 45 || code === 48) return { condition: 'Misty Fog', category: 'fog' };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return { condition: 'Rain Showers', category: 'rain' };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { condition: 'Snowfall', category: 'snow' };
  }
  if (code >= 95) return { condition: 'Thunderstorm', category: 'storm' };
  return { condition: 'Ambient Sky', category: 'partly-cloudy' };
}

function readWeatherCache(city: string): WeatherData | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${city.trim().toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WeatherData;
    if (Date.now() - parsed.updatedAt < CACHE_TTL_MS) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeWeatherCache(city: string, data: WeatherData) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${city.trim().toLowerCase()}`, JSON.stringify(data));
  } catch {
    // Ignore cache write errors
  }
}

export function useWeather(city: string, enabled: boolean) {
  const [weather, setWeather] = useState<WeatherData | null>(() =>
    city ? readWeatherCache(city) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback((force = true) => {
    if (force && city.trim()) {
      try {
        localStorage.removeItem(`${CACHE_PREFIX}${city.trim().toLowerCase()}`);
      } catch {
        // Ignore storage error
      }
    }
    setNonce((n) => n + 1);
  }, [city]);

  useEffect(() => {
    const trimmed = city.trim();
    if (!enabled || !trimmed) return;

    const cached = readWeatherCache(trimmed);
    if (cached && nonce === 0) {
      setWeather(cached);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          trimmed,
        )}&count=1&language=en&format=json`;
        const geoRes = await fetch(geoUrl, { signal: controller.signal });
        if (!geoRes.ok) throw new Error(`Geocoding error (${geoRes.status})`);
        const geoJson = (await geoRes.json()) as {
          results?: Array<{
            name: string;
            country?: string;
            latitude: number;
            longitude: number;
          }>;
        };

        const hit = geoJson.results?.[0];
        if (!hit) {
          throw new Error(`City not found: ${trimmed}`);
        }

        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day`;
        const wxRes = await fetch(forecastUrl, { signal: controller.signal });
        if (!wxRes.ok) throw new Error(`Weather API error (${wxRes.status})`);
        const wxJson = (await wxRes.json()) as {
          current?: {
            temperature_2m?: number;
            apparent_temperature?: number;
            relative_humidity_2m?: number;
            weather_code?: number;
            wind_speed_10m?: number;
            is_day?: number;
          };
        };

        const cur = wxJson.current;
        if (!cur) throw new Error('Weather payload missing current conditions');

        const code = cur.weather_code ?? 0;
        const mapped = mapWmoCode(code);
        const result: WeatherData = {
          city: hit.name,
          country: hit.country ?? '',
          tempC: Math.round(cur.temperature_2m ?? 0),
          feelsLikeC: Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? 0),
          humidity: Math.round(cur.relative_humidity_2m ?? 0),
          windKmh: Math.round(cur.wind_speed_10m ?? 0),
          code,
          condition: mapped.condition,
          category: mapped.category,
          isDay: cur.is_day !== 0,
          updatedAt: Date.now(),
        };

        if (!active) return;
        writeWeatherCache(trimmed, result);
        setWeather(result);
        setError(null);
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Weather unavailable');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [city, enabled, nonce]);

  return { weather, loading, error, refresh };
}
