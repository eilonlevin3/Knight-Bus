// Route icons: which numbers need their destination written beside them.
// @req REQ-HOME-3

import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatedNumbers, operatorColor } from '../src/views/liveInfo.js';
import { CityData } from '../src/cityData.js';

test('a number that is listed more than once is marked as repeated', () => {
  const routes = [{ short: '6' }, { short: '62' }, { short: '6' }, { short: '62א' }];
  assert.deepEqual([...repeatedNumbers(routes)], ['6']);
  assert.deepEqual([...repeatedNumbers([{ short: '1' }, { short: '2' }])], []);
});

test('each company of a city gets its own color', () => {
  const raw = { cityId: 'x', agencies: ['דן', 'אגד', 'מטרופולין'], stops: [['s1', '1', 'A', 32, 34.7], ['s2', '2', 'B', 32.01, 34.71]],
    routes: [['1', '5', 'B', 0, 3, [0, 1], ''], ['2', '5', 'B', 1, 3, [0, 1], ''], ['3', '7', 'B', 2, 3, [0, 1], ''], ['4', '9', 'B', 0, 3, [0, 1], '']] };
  const city = new CityData(raw, { version: 'v' });
  const colors = ['1', '2', '3'].map((id) => operatorColor(city.routes.get(id).agencyRank));
  assert.equal(new Set(colors).size, 3);
  assert.equal(operatorColor(city.routes.get('4').agencyRank), colors[0]); // same company, same color
});

test('a route knows the ids of the alternatives merged into it; old saved ids still resolve', () => {
  // REQ-DATA-10. Row: id, number, destination, agency, type, stops, shape, minutes,
  // source, other patterns, opposite, merged ids.
  const raw = {
    cityId: 'x', agencies: ['Dan'],
    stops: [['s1', '100', 'A', 32, 34.7], ['s2', '101', 'B', 32.01, 34.71]],
    routes: [
      ['10', '6', 'B', 0, 3, [0, 1], '', null, null, [], '20', ['11', '12']],
      ['20', '6', 'A', 0, 3, [1, 0], '', null, null, [], '10'],
    ],
  };
  const city = new CityData(raw, { version: 'v' });
  assert.deepEqual(city.routes.get('10').liveIds, ['10', '11', '12']);
  assert.deepEqual(city.routes.get('20').liveIds, ['20']);
  assert.deepEqual(city.currentRouteIds(['11', '10', '20', '12']), ['10', '20']);
  assert.equal(city.routesAtStop('s1').length, 2);
});
