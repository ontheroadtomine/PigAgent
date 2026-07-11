import { AgentTool } from '../types';

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Nexa/1.0',
    },
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data?.reason || data?.message || text}`);
  return data;
}

function weatherCodeLabel(code: number): string {
  const labels: Record<number, string> = {
    0: '晴',
    1: '大部晴朗',
    2: '局部多云',
    3: '阴',
    45: '雾',
    48: '雾凇',
    51: '小毛毛雨',
    53: '中等毛毛雨',
    55: '较强毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    80: '小阵雨',
    81: '中等阵雨',
    82: '强阵雨',
    95: '雷暴',
    96: '雷暴伴小冰雹',
    99: '雷暴伴大冰雹',
  };
  return labels[code] || `天气代码 ${code}`;
}

export const weatherCurrentTool: AgentTool = {
  name: 'weather_current',
  schema: {
    type: 'function',
    function: {
      name: 'weather_current',
      description: 'Get current real-time weather for a city or place. Use this for today, now, temperature, rain, wind, or forecast questions.',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City or place name, such as 成都, Shanghai, Beijing, or Chengdu.',
          },
        },
        required: ['location'],
      },
    },
  },
  async run(args) {
    const location = String(args.location || '').trim();
    if (!location) throw new Error('location is required');

    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=zh&format=json`;
    const geo = await fetchJson(geoUrl);
    const place = geo?.results?.[0];
    if (!place) throw new Error(`未找到地点：${location}`);

    const forecastUrl = [
      'https://api.open-meteo.com/v1/forecast',
      `?latitude=${encodeURIComponent(place.latitude)}`,
      `&longitude=${encodeURIComponent(place.longitude)}`,
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m',
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      '&forecast_days=1',
      '&timezone=auto',
    ].join('');
    const weather = await fetchJson(forecastUrl);
    const current = weather.current || {};
    const daily = weather.daily || {};

    return {
      source: 'Open-Meteo',
      location: {
        name: place.name,
        country: place.country,
        admin1: place.admin1,
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: weather.timezone,
      },
      current: {
        time: current.time,
        temperatureC: current.temperature_2m,
        apparentTemperatureC: current.apparent_temperature,
        humidityPercent: current.relative_humidity_2m,
        precipitationMm: current.precipitation,
        rainMm: current.rain,
        weatherCode: current.weather_code,
        weather: weatherCodeLabel(Number(current.weather_code)),
        windSpeedKmh: current.wind_speed_10m,
        windDirectionDeg: current.wind_direction_10m,
      },
      today: {
        weatherCode: daily.weather_code?.[0],
        weather: weatherCodeLabel(Number(daily.weather_code?.[0])),
        maxTemperatureC: daily.temperature_2m_max?.[0],
        minTemperatureC: daily.temperature_2m_min?.[0],
        precipitationProbabilityMaxPercent: daily.precipitation_probability_max?.[0],
      },
    };
  },
};
