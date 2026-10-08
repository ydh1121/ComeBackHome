import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, webkit, devices } from 'playwright';

const ORIGIN = 'https://come-back-home.pages.dev';
const failures = [];
const results = [];

async function verifyOn(browserType, label, device = {}) {
  const browser = await browserType.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({
      ...device,
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    });
    const api = context.request;
    const configResponse = await api.get(ORIGIN + '/api/client-config');
    assert.equal(configResponse.status(), 200, 'canonical client config HTTP status');
    const config = await configResponse.json();
    assert.equal(config?.kakaoMaps?.configured, true, 'Maps config must be active');
    assert.ok(String(config?.kakaoMaps?.javaScriptKey ?? '').length >= 8,
      'Browser Maps JavaScript key missing');

    const peopleResponse = await api.get(ORIGIN + '/api/people');
    assert.equal(peopleResponse.status(), 200, 'canonical people API HTTP status');
    const people = (await peopleResponse.json()).people ?? [];
    assert.ok(people.length, 'No canonical person available for read-only QA');
    let target = null;
    let originCoordinate = null;
    for (const person of people) {
      const response = await api.get(
        ORIGIN + '/api/people/' + encodeURIComponent(person.id) + '/places/origin'
      );
      const place = response.ok() ? (await response.json()).place : null;
      if (place?.coordinate && Number.isFinite(place.coordinate.x) &&
          Number.isFinite(place.coordinate.y)) {
        target = person.id;
        originCoordinate = place.coordinate;
        break;
      }
    }
    assert.ok(target, 'No person with a persisted origin coordinate');
    const pathId = encodeURIComponent(target);
    const proximityUrl = new URL(ORIGIN + '/api/providers/transit-nearby');
    proximityUrl.searchParams.set('x', String(originCoordinate.x));
    proximityUrl.searchParams.set('y', String(originCoordinate.y));
    const nearbyResponse = await api.get(proximityUrl.toString());
    assert.equal(nearbyResponse.status(), 200, 'canonical nearby transit endpoint');
    const nearbyPayload = await nearbyResponse.json();
    const nearby = nearbyPayload.results ?? [];
    assert.ok(nearby.length, 'No nearby transit candidates for saved origin');
    assert.ok(nearby.every((item) => Number.isFinite(item.distanceM) &&
      item.distanceM <= (item.mode === 'BUS' ? 800 : 900)),
      'Multi-km transit outlier leaked into normal nearby list');
    assert.ok(nearby.every((item, index) => index === 0 ||
      nearby[index - 1].distanceM <= item.distanceM),
      'Nearby transit candidates not sorted by distance');
    assert.ok(nearby.filter((item) => item.mode === 'BUS').every((item) =>
      item.providerId && (
        item.id.startsWith('seoul-bus:') ? Boolean(item.displayCode) :
          item.id.startsWith('kakao-transit:bus:')
      )),
      'Nearby bus lacks an official station ID or strict category provenance');
    assert.ok(nearby.some((item) => item.mode === 'BUS'),
      'Nearby bus discovery returned no candidate; source=' +
        (nearbyPayload.sourceStatus?.bus ?? 'UNKNOWN'));

    const page = await context.newPage();
    const attemptedWrites = [];
    await page.route('**/api/**', async (route) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        attemptedWrites.push(route.request().method());
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    const javascriptErrors = [];
    page.on('pageerror', (error) => javascriptErrors.push(error.name ?? 'Error'));

    const mapPath = ORIGIN + '/people/' + pathId + '/commute/origin/access';
    await page.goto(mapPath, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('[data-page="TransitAccessPicker"]').waitFor({ timeout: 35_000 });
    await page.locator('[data-map-state="ready"]').waitFor({ timeout: 35_000 });
    const renderedMap = await page.locator('.kakao-transit-map').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        hasRenderedChildren: element.children.length > 0,
        dimensionsValid: rect.width > 100 && rect.height > 100,
        sdkReady: Boolean(window.kakao?.maps?.Map),
      };
    });
    assert.equal(renderedMap.sdkReady, true, 'Kakao Maps SDK not initialized');
    assert.equal(renderedMap.dimensionsValid, true, 'Interactive map dimensions invalid');
    assert.equal(renderedMap.hasRenderedChildren, true, 'Interactive map DOM not rendered');

    // Actual screenshot-equivalent QA: activate a REAL Kakao marker and
    // inspect the rendered React panel. No manually injected fake card.
    const markerTargets = page.locator('.cbh-transit-map-marker');
    await markerTargets.first().waitFor({ state: 'visible', timeout: 20_000 });
    const markerTitles = await markerTargets.evaluateAll((nodes) =>
      nodes.map((node, index) => ({
        index,
        name: node.getAttribute('title') ?? '',
      }))
    );
    assert.ok(markerTitles.length, 'Clickable transit markers are not rendered');
    const hitChecks = await markerTargets.evaluateAll((nodes) => {
      const mapRect = document.querySelector('.kakao-transit-map')?.getBoundingClientRect();
      return nodes.map((marker) => {
        const bounds = marker.getBoundingClientRect();
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        const isInside = mapRect && x >= mapRect.left && x <= mapRect.right &&
          y >= mapRect.top && y <= mapRect.bottom;
        if (!isInside) return { visibleOnMap: false, unblocked: true };
        const top = document.elementFromPoint(x, y);
        return {
          visibleOnMap: true,
          unblocked: Boolean(top === marker || marker.contains(top)),
          targetId: marker.getAttribute('data-transit-id'),
          blockingId: top?.closest('.cbh-transit-map-marker')?.getAttribute('data-transit-id') ??
            top?.tagName ?? 'NONE',
          offset: [marker.getAttribute('data-spread-x'), marker.getAttribute('data-spread-y')],
          blockerClass: top instanceof HTMLElement ? top.className?.toString().slice(0, 100) : '',
          blockerMarkup: top?.outerHTML?.slice(0, 180),
          blockerStack: document.elementsFromPoint(x, y).slice(0, 5)
            .map((item) => item.tagName + '.' +
              String(item.className ?? '').slice(0, 60)),
        };
      });
    });
    assert.ok(hitChecks.filter((item) => item.visibleOnMap).length > 0,
      'No map marker is within the visible viewport');
    assert.ok(hitChecks.every((item) => !item.visibleOnMap || item.unblocked),
      'Overlapping map marker blocks hit center: ' +
      JSON.stringify(hitChecks.filter((item) => item.visibleOnMap && !item.unblocked).slice(0,8)));
    const preferred = markerTitles.find((item) => item.name.includes('차병원사거리')) ??
      markerTitles.sort((a, b) => b.name.length - a.name.length)[0];
    const marker = markerTargets.nth(preferred.index);
    // Pointer/touch on the REAL overlay button: no programmatic dispatch,
    // injected fake card or D1 mutation is allowed.
    if (label.startsWith('mobile')) await marker.tap();
    else await marker.click();
    const activePanel = page.getByRole('region', { name: '지도에서 선택한 교통편' });
    await activePanel.waitFor({ timeout: 10_000 });
    const clickMode = label.startsWith('mobile') ? 'NATIVE_TOUCH' : 'NATIVE_POINTER';
    const markerClick = { name: preferred.name };
    const activeName = markerClick.name.replace(/^(버스|지하철) · /, '');
    assert.ok((await activePanel.innerText()).includes(activeName),
      'Live active transit panel did not match focused marker');
    assert.ok((await page.locator('.transit-row.map-active').innerText()).includes(activeName),
      'Active map marker did not highlight the same entity in the list');
    assert.equal(attemptedWrites.length, 0,
      'Focusing a map marker must not mutate production D1');

    // Reverse direction: clicking a LIST row focuses the identical Kakao
    // marker, opens preview and must not send any D1 write request.
    const focusRows = page.locator('.transit-row');
    const alternateRow = focusRows.filter({ hasNotText: activeName }).first();
    await alternateRow.waitFor({ state: 'visible', timeout: 10_000 });
    const reverseId = await alternateRow.getAttribute('id');
    const reverseTransitId = reverseId?.replace(/^transit-result-/, '');
    assert.ok(reverseTransitId, 'List row lacks stable transit identity');
    const focusControl = alternateRow.locator('.transit-row-focus');
    if (label.startsWith('mobile')) await focusControl.tap();
    else await focusControl.click();
    await page.waitForFunction((id) =>
      document.querySelector('.cbh-transit-map-marker.is-active')?.getAttribute('data-transit-id') === id,
      reverseTransitId, { timeout: 10_000 });
    assert.equal(await page.locator('.transit-row.map-active').getAttribute('id'), reverseId,
      'List click did not activate matching transit row');
    assert.equal(await activePanel.getAttribute('data-active-id'), reverseTransitId,
      'List click did not update active preview identity');
    assert.equal(attemptedWrites.length, 0,
      'Viewing a list row must not change persisted selection');

    const checkedWidths = [];
    const measured = [];
    mkdirSync('artifacts/cbh-transit-card', { recursive: true });
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 820 });
      const geometry = await page.locator('.transit-map-active').evaluate((card) => {
        const panel = card.getBoundingClientRect();
        const name = card.querySelector('.transit-active-name');
        const nameBox = name?.getBoundingClientRect();
        const action = card.querySelector('.transit-active-action');
        const actionBox = action?.getBoundingClientRect();
        const filterBox = document.querySelector('.candidate-filter')?.getBoundingClientRect();
        const searchBox = document.querySelector('.transit-inline-search')?.getBoundingClientRect();
        const summaryBox = document.querySelector('.transit-selected-summary')?.getBoundingClientRect();
        const firstRow = document.querySelector('.transit-row')?.getBoundingClientRect();
        const lineHeight = name ? parseFloat(getComputedStyle(name).lineHeight) : 0;
        return {
          panelWidth: panel.width, panelHeight: panel.height,
          nameWidth: nameBox?.width ?? 0,
          nameLines: nameBox && lineHeight ? Math.round(nameBox.height / lineHeight) : 0,
          actionWidth: actionBox?.width ?? 0,
          listFocusWidth: document.querySelector('.transit-row-focus')?.getBoundingClientRect().width ?? 0,
          listToggleWidth: document.querySelector('.transit-row-toggle')?.getBoundingClientRect().width ?? 0,
          actionVisible: Boolean(actionBox && actionBox.width > 40 && actionBox.height >= 32),
          verticalGap: filterBox ? Math.round(filterBox.top - panel.bottom) : -1,
          filterChipCount: document.querySelectorAll('.candidate-filter .filter-btn').length,
          searchGap: filterBox && searchBox ? Math.round(searchBox.top - filterBox.bottom) : -1,
          summaryGap: searchBox && summaryBox ? Math.round(summaryBox.top - searchBox.bottom) : null,
          resultGap: summaryBox && firstRow ? Math.round(firstRow.top - summaryBox.bottom) : null,
          overflow: card.scrollWidth > card.clientWidth + 1,
        };
      });
      assert.ok(geometry.panelWidth > 220 && geometry.nameWidth >= 138 &&
        geometry.nameLines >= 1 && geometry.nameLines <= 3 &&
        geometry.panelHeight <= 128 && geometry.actionVisible &&
        geometry.listFocusWidth > 165 && geometry.listToggleWidth >= 40 && !geometry.overflow &&
        geometry.verticalGap >= 12 && geometry.verticalGap <= 24 &&
        geometry.filterChipCount === 3 && geometry.searchGap >= 6,
        'Actual selected card geometry failed at ' + width + 'px: ' +
          JSON.stringify(geometry));
      measured.push({ width, ...geometry });
      checkedWidths.push(width);
      if (width === 375 || width === 390) {
        await activePanel.scrollIntoViewIfNeeded();
        const cardBox = await activePanel.boundingBox();
        const summaryBox = await page.locator('.transit-selected-summary').boundingBox();
        if (cardBox) {
          // Crop BELOW the map: no private saved-place context is stored.
          await page.screenshot({
            path: 'artifacts/cbh-transit-card/' + label + '-' + width + '.png',
            clip: {
              x: Math.max(0, cardBox.x - 1),
              y: Math.max(0, cardBox.y - 1),
              width: Math.ceil(cardBox.width + 2),
              height: Math.ceil(Math.min(
                470, Math.max(200, (summaryBox?.y ?? (cardBox.y + 260)) -
                  cardBox.y + (summaryBox?.height ?? 50) + 12)
              )),
            },
          });
        }
      }
    }
    const savedAccessResponse = await api.get(
      ORIGIN + '/api/people/' + pathId + '/commute?kind=origin'
    );
    assert.equal(savedAccessResponse.status(), 200, 'D1 origin access readback');
    const savedOriginPoints = (await savedAccessResponse.json()).accessPoints ?? [];
    const selectedOriginCount = savedOriginPoints.filter((point) => point.selected === true).length;
    const selectedChipCountBeforePan = await page.locator('.transit-selected-chip').count();
    assert.equal(selectedChipCountBeforePan, selectedOriginCount,
      'Standalone picker selection count differs from persisted D1 flags');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-map-state="ready"]').waitFor({ timeout: 35_000 });
    // useCommuteOverview fetches the stored D1 selection independently of
    // Kakao's SDK loading. Map READY does NOT mean selected-set readback READY.
    await page.waitForFunction((expected) =>
      document.querySelectorAll('.transit-selected-chip').length === expected,
      selectedOriginCount, { timeout: 20_000 });
    assert.equal(await page.locator('.transit-selected-chip').count(), selectedOriginCount,
      'Saved D1 selection failed to reappear after async overview hydration');

    // Simulate actual map drag in a browser, never a state-only unit mock.
    const mapBox = await page.locator('.kakao-transit-map').boundingBox();
    assert.ok(mapBox, 'Interactive map has no drag target');
    const startX = mapBox.x + mapBox.width * 0.65;
    const startY = mapBox.y + mapBox.height * 0.45;
    if (!label.startsWith('mobile')) {
      const dragResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/providers/transit-nearby' &&
          url.searchParams.get('x') !== String(originCoordinate.x) &&
          response.request().method() === 'GET';
      }, { timeout: 25_000 });
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 110, startY - 55, { steps: 12 });
      await page.mouse.up();
      const draggedResponse = await dragResponse;
      assert.equal(draggedResponse.status(), 200, 'map-center requery failed');
      await page.waitForTimeout(450);
      assert.equal(await page.locator('.transit-selected-chip').count(),
        selectedChipCountBeforePan,
        'Map pan cleared previously stored transit selections');
      const unchangedPlace = await api.get(
        ORIGIN + '/api/people/' + pathId + '/places/origin'
      );
      assert.equal(unchangedPlace.status(), 200, 'saved place readback after pan');
      const anchorAfterPan = (await unchangedPlace.json()).place?.coordinate;
      assert.deepEqual(anchorAfterPan, originCoordinate,
        'Map pan must never mutate saved origin coordinates');
    }

    const input = page.locator('.transit-inline-search input[type="search"]');
    const transitResponseWait = page.waitForResponse(
      (response) => response.url().includes('/api/providers/transit-search') &&
        response.request().method() === 'GET',
      { timeout: 35_000 },
    );
    await input.fill('언주역');
    const transitResponse = await transitResponseWait;
    assert.equal(transitResponse.status(), 200, 'transit-only search HTTP status');
    const transitResults = (await transitResponse.json()).results ?? [];
    assert.ok(transitResults.length, '언주역 transit search unexpectedly empty');
    assert.ok(transitResults.every((item) => item.mode === 'BUS' || item.mode === 'SUBWAY'),
      'Non-transit POI leaked into transit API results');
    assert.ok(!transitResults.some((item) =>
      /떡볶이|라운지|피트니스|미용실|헬스|카페|코스메틱/.test(item.name ?? '')),
      'General business leaked into transit results');
    await page.locator('.transit-row').first().waitFor({ timeout: 12_000 });

    await page.goto(ORIGIN + '/people/' + pathId + '/place/origin',
      { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const placeInput = page.locator('.address-search-control input');
    await placeInput.fill('코엑스');
    await page.locator('.search-result-row').first().waitFor({ timeout: 25_000 });

    // Read-only route baseline. Log only counts and status categories.
    // Do not log person IDs, raw coordinates, addresses or provider secrets.
    const [destPlaceResponse, savedOriginResponse, savedDestResponse, statusResponse] = await Promise.all([
      api.get(ORIGIN + '/api/people/' + pathId + '/places/destination'),
      api.get(ORIGIN + '/api/people/' + pathId + '/commute?kind=origin'),
      api.get(ORIGIN + '/api/people/' + pathId + '/commute?kind=destination'),
      api.get(ORIGIN + '/api/providers/status'),
    ]);
    const destinationPlace = destPlaceResponse.ok() ? (await destPlaceResponse.json()).place : null;
    const savedOrigin = savedOriginResponse.ok() ? await savedOriginResponse.json() : {};
    const savedDestination = savedDestResponse.ok() ? await savedDestResponse.json() : {};
    const providerStatus = statusResponse.ok() ? await statusResponse.json() : {};
    const originAccess = savedOrigin.accessPoints ?? [];
    const destinationAccess = savedDestination.accessPoints ?? [];
    const savedRoute = (savedOrigin.savedRoutes ?? []).find((item) => item.active) ??
      (savedOrigin.savedRoutes ?? [])[0] ?? null;
    const configuredOrigin = savedRoute?.originAccessPointIds ??
      (savedRoute?.originAccessPointId ? [savedRoute.originAccessPointId] : []);
    const configuredDestination = savedRoute?.destinationAccessPointIds ??
      (savedRoute?.destinationAccessPointId ? [savedRoute.destinationAccessPointId] : []);
    const validOriginCount = configuredOrigin.filter((id) => originAccess.some((p) => p.id === id)).length;
    const validDestinationCount = configuredDestination.filter((id) => destinationAccess.some((p) => p.id === id)).length;
    const probe = {
      originCoordinatePresent: Boolean(originCoordinate),
      destinationCoordinatePresent: Boolean(destinationPlace?.coordinate),
      selectedOriginCount: originAccess.filter((p) => p.selected).length,
      selectedDestinationCount: destinationAccess.filter((p) => p.selected).length,
      routeSpecificOriginCount: validOriginCount,
      routeSpecificDestinationCount: validDestinationCount,
      staleAccessIdCount: configuredOrigin.length + configuredDestination.length -
        validOriginCount - validDestinationCount,
      preferredRouteConfigured: Boolean(savedOrigin.preferredRouteCandidateId),
      providerEnabled: providerStatus.enabled === true,
      providerSource: providerStatus.source ?? 'UNKNOWN',
      placePairStatus: 'NOT_RUN',
      placePairRoutes: 0,
    };
    if (originCoordinate && destinationPlace?.coordinate) {
      const u = new URL(ORIGIN + '/api/providers/routes');
      u.searchParams.set('originX', String(originCoordinate.x));
      u.searchParams.set('originY', String(originCoordinate.y));
      u.searchParams.set('destinationX', String(destinationPlace.coordinate.x));
      u.searchParams.set('destinationY', String(destinationPlace.coordinate.y));
      try {
        const response = await api.get(u.toString());
        probe.placePairStatus = response.status() === 200 ? 'HTTP_200' :
          [401, 403].includes(response.status()) ? 'AUTH' : 'HTTP_' + response.status();
        const body = await response.json().catch(() => null);
        if (response.ok()) {
          probe.placePairRoutes = (body?.results ?? []).length;
        } else {
          // The Worker forwards only a numeric upstream code; redact any
          // private error string, location or provider request URL.
          const safeCode = typeof body?.error === 'string'
            ? /^Provider request failed: kakao-map\/public-transit-routing HTTP \d{3} CODE (-?\d{1,5})$/.exec(body.error)?.[1]
            : undefined;
          if (safeCode) probe.placePairUpstreamCode = Number(safeCode);
        }
      } catch {
        probe.placePairStatus = 'NETWORK_ERROR';
      }
    }
    console.log('CBH_ROUTE_PROBE_' + label + '=' + JSON.stringify(probe));
    await page.goto(ORIGIN + '/people/' + pathId + '/commute',
      { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('[data-page="CommuteRouteEditPage"]').waitFor({ timeout: 30_000 });
    const diagnostic = await page.locator('[data-page="CommuteRouteEditPage"]').evaluate((node) => ({
      status: node.getAttribute('data-route-search-status') ?? 'UNAVAILABLE',
      pairs: Number(node.getAttribute('data-route-pair-count') ?? 0),
      candidates: Number(node.getAttribute('data-route-candidate-count') ?? 0),
      empty: node.querySelector('.search-inline-status[data-state]')?.getAttribute('data-state') ?? 'NONE',
    }));
    console.log('CBH_ROUTE_SURFACE_' + label + '=' + JSON.stringify(diagnostic));
    const routeCards = page.locator('.route-candidate');
    await routeCards.first().waitFor({ timeout: 25_000 });
    const candidates = await routeCards.count();
    assert.ok(candidates >= 2, 'Cannot verify route A -> B: fewer than two candidates');
    await routeCards.nth(1).click();
    assert.equal(await routeCards.nth(1).getAttribute('aria-pressed'), 'true',
      'Second recommended route was not selected');
    assert.equal(await routeCards.first().getAttribute('aria-pressed'), 'false',
      'Previous recommended route remained selected');
    await page.getByRole('button', { name: '선택한 추천 경로 저장' })
      .waitFor({ timeout: 10_000 });

    // Existing persisted preference -> actual Today route, without writing a
    // new preference or triggering real commute/presence events.
    const preferenceResponse = await api.get(
      ORIGIN + '/api/people/' + pathId + '/commute?kind=origin'
    );
    assert.equal(preferenceResponse.status(), 200, 'D1 route preference readback');
    const preferredRoute = (await preferenceResponse.json()).preferredRouteCandidateId;
    const visibleRouteIds = await routeCards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-route-candidate-id')));
    await page.evaluate((id) => {
      localStorage.setItem('cbh:selected-person-id', id);
    }, target);
    await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('[data-page="TodayPage"][data-eta-status]').waitFor({ timeout: 35000 });
    const todayRouteId = await page.locator('[data-page="TodayPage"]')
      .getAttribute('data-selected-route-id');
    const todayEtaStatus = await page.locator('[data-page="TodayPage"]')
      .getAttribute('data-eta-status');
    const preferredRouteUse = !preferredRoute ? 'NO_SAVED_PREFERENCE' :
      !visibleRouteIds.includes(preferredRoute) ? 'SAVED_ROUTE_NOT_IN_CURRENT_CANDIDATES' :
      todayRouteId === preferredRoute && todayEtaStatus !== 'UNKNOWN'
        ? 'PASS_EXISTING_SAVED_ROUTE'
        : 'NOT_MATCHED_WITH_ETA';

    assert.equal(attemptedWrites.length, 0,
      'Read-only QA unexpectedly attempted production mutations');
    const destinationReadback = await api.get(
      ORIGIN + '/api/people/' + pathId + '/commute?kind=destination'
    );
    const destinationPoints = destinationReadback.ok()
      ? ((await destinationReadback.json()).accessPoints ?? []) : [];
    const destinationPlaceResponse = await api.get(
      ORIGIN + '/api/people/' + pathId + '/places/destination'
    );
    const hasDestination = destinationPlaceResponse.ok() &&
      Boolean((await destinationPlaceResponse.json()).place?.coordinate);
    results.push({
      browser: label,
      mapSDK: 'PASS',
      mapDOM: 'PASS',
      mapMarkerDOM: 'PASS',
      markerInteraction: clickMode + '_PASS',
      markerHitCentersClear: hitChecks.filter((item) => item.visibleOnMap).length,
      markerListSync: 'FOCUS_ONLY_PASS',
      listMarkerSync: 'FOCUS_ONLY_PASS_NO_WRITES',
      realActiveCard: 'PASS',
      activeCardGeometry: measured,
      mapCenterRequery: label.startsWith('mobile') ? 'NOT_RUN_TOUCH_DRAG' : 'PASS',
      layoutWidths: checkedWidths,
      nearbyDistanceCap: 'PASS',
      nearbyTotal: nearby.length,
      nearbyBusCount: nearby.filter((item) => item.mode === 'BUS').length,
      originPersistedSelectionCount: selectedOriginCount,
      originUnselectedAccessCount: savedOriginPoints.filter((item) => item.selected === false).length,
      destinationSavedPlace: hasDestination,
      destinationPersistedSelectionCount: destinationPoints.filter((item) => item.selected === true).length,
      destinationUnselectedAccessCount: destinationPoints.filter((item) => item.selected === false).length,
      persistedSelectionReload: 'PASS_READ_ONLY',
      busSource: nearbyPayload.sourceStatus?.bus ?? 'UNKNOWN',
      nearbySubwayCount: nearby.filter((item) => item.mode === 'SUBWAY').length,
      nearbyMaximumMeters: Math.max(...nearby.map((item) => item.distanceM)),
      transitOnly: 'PASS',
      transitCount: transitResults.length,
      placeBusiness: 'PASS',
      routeDraftSelection: 'PASS',
      readOnlyPreferredRouteUse: preferredRouteUse,
      productionWrites: 0,
      javascriptErrors: javascriptErrors.length,
      sensitiveValuesLogged: false,
    });
  } catch (error) {
    failures.push(label + ': ' + (error instanceof Error ? error.message : String(error)));
  } finally {
    await context?.close();
    await browser.close();
  }
}

await verifyOn(chromium, 'desktop-chromium', { viewport: { width: 1365, height: 900 } });
await verifyOn(webkit, 'mobile-webkit-emulation', devices['iPhone 13']);

console.log(JSON.stringify({ results, failures, readOnly: true }, null, 2));
if (failures.length) process.exit(1);
