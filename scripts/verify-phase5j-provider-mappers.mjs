import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = async (name) => JSON.parse(await readFile(new URL('../test/fixtures/providers/' + name, import.meta.url), 'utf8'));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const source = await readFile(new URL('../worker/providers/mappers.ts', import.meta.url), 'utf8');
for (const forbidden of ['fetch(', 'KAKAO_REST_API_KEY', 'SEOUL_SUBWAY_API_KEY', 'SEOUL_BUS_SERVICE_KEY', 'dapi.kakao.com', 'swopenAPI.seoul.go.kr']) {
  expect(!source.includes(forbidden), 'fixture mapper contains live integration token ' + forbidden);
}

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const mappers = await vite.ssrLoadModule('/worker/providers/mappers.ts');

  const places = mappers.mapKakaoPlaceSearch(await fixture('kakao-place.json'));
  expect(places.length === 1, 'Kakao place fixture count mismatch');
  expect(places[0]?.providerId === '26338954', 'Kakao place id mismatch');
  expect(places[0]?.roadAddress === '서울 강남구 영동대로 513', 'Kakao road address mismatch');
  expect(places[0]?.lotAddress === '서울 강남구 삼성동 159', 'Kakao lot address mismatch');
  expect(places[0]?.coordinate?.x === 127.05902969025047, 'Kakao longitude mismatch');

  const routePayload = await fixture('kakao-public-transit.json');
  const routes = mappers.mapKakaoPublicTransitRoutes(routePayload);
  const routesAgain = mappers.mapKakaoPublicTransitRoutes(routePayload);
  expect(routes.length === 1, 'Kakao route fixture count mismatch');
  expect(routes[0]?.id === routesAgain[0]?.id, 'Kakao route id must be deterministic');
  expect(routes[0]?.totalMinutes === 15, 'Kakao route totalTime mapping mismatch');
  expect(routes[0]?.transferCount === 1, 'Kakao transfer mapping mismatch');
  expect(routes[0]?.walkMinutes === 5, 'Kakao walking step time mapping mismatch');
  expect(routes[0]?.fare === 1500, 'Kakao fare mapping mismatch');
  expect(!('personId' in (routes[0] ?? {})), 'Provider route result must not contain personId');
  expect(routes[0]?.steps?.map((step) => step.type).join(',') === 'WALKING,BUS,WALKING', 'Kakao route step mapping mismatch');

  const busStops = mappers.mapSeoulBusStops(await fixture('seoul-bus-stops.json'));
  expect(busStops.length === 1, 'Seoul bus stop fixture count mismatch');
  expect(busStops[0]?.providerId === '122000606', 'Seoul bus stId mapping mismatch');
  expect(busStops[0]?.displayCode === '23813', 'Seoul bus arsId mapping mismatch');
  expect(busStops[0]?.distanceM === 153, 'Seoul bus distance mapping mismatch');

  const busArrivals = mappers.mapSeoulBusArrivals(
    await fixture('seoul-bus-arrivals.json'),
    '100100118',
  );
  expect(busArrivals.length === 2, 'Seoul bus arrival count mismatch');
  expect(busArrivals[0]?.minutes === 2 && busArrivals[1]?.minutes === 5, 'Seoul bus exps mapping mismatch');
  expect(busArrivals[0]?.providerVehicleId === '서울74사1234', 'Seoul bus vehicle mapping mismatch');
  expect(busArrivals[0]?.observedAt === '2026-10-05T09:45:00+09:00', 'Seoul bus mkTm timestamp mismatch');

  const subwayStations = mappers.mapSeoulSubwayStations(await fixture('seoul-subway-stations.json'));
  expect(subwayStations.length === 1, 'Seoul subway station count mismatch');
  expect(subwayStations[0]?.providerId === '0222', 'Seoul subway station id mismatch');
  expect(subwayStations[0]?.displayCode === '222', 'Seoul subway FR_CODE mismatch');
  expect(subwayStations[0]?.line === '02호선', 'Seoul subway line mismatch');

  const subwayArrivals = mappers.mapSeoulSubwayArrivals(await fixture('seoul-subway-arrivals.json'));
  expect(subwayArrivals.length === 1, 'Seoul subway arrival count mismatch');
  expect(subwayArrivals[0]?.minutes === 3, 'Seoul subway barvlDt mapping mismatch');
  expect(subwayArrivals[0]?.providerVehicleId === '2258', 'Seoul subway train number mismatch');
  expect(subwayArrivals[0]?.observedAt === '2026-10-05T09:45:30+09:00', 'Seoul subway recptnDt mismatch');

  const positions = mappers.mapSeoulSubwayTrainPositions(await fixture('seoul-subway-positions.json'));
  expect(positions.length === 1, 'Seoul subway position count mismatch');
  expect(positions[0]?.line === '2호선', 'Seoul subway position line mismatch');
  expect(positions[0]?.direction === '상행/내선', 'Seoul subway position direction mismatch');
  expect(positions[0]?.terminalName === '성수', 'Seoul subway terminal mapping mismatch');
  expect(positions[0]?.express === false, 'Seoul subway express flag mismatch');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5J fixture-backed provider mapper verification passed');

// Phase 5J dependency-backed verification trigger.
