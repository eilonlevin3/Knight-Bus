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

test('a train station lists the trains of one direction at a time', () => {
  // REQ-DATA-13. Three stations south to north; trains both ways, and a bus at the middle one.
  const raw = {
    cityId: 'x', agencies: ['Rail', 'Dan'],
    stops: [['a', '1', 'South', 31.2, 34.8], ['b', '2', 'Middle', 32.0, 34.8], ['c', '3', 'North', 32.8, 35.0]],
    routes: [
      ['n1', '', 'North', 0, 2, [0, 1, 2], ''],
      ['n2', '', 'North', 0, 2, [1, 2], ''],
      ['s1', '', 'South', 0, 2, [2, 1, 0], ''],
      ['bus', '5', 'Middle', 1, 3, [1, 0], ''],
    ],
  };
  const city = new CityData(raw, { version: 'v' });
  assert.equal(city.routes.get('n1').heading, 'north');
  assert.equal(city.routes.get('s1').heading, 'south');
  assert.equal(city.routes.get('bus').heading, null);
  assert.deepEqual(city.trainHeadings('b'), { north: 2, south: 1 });
  assert.equal(city.defaultHeading('b'), 'north');
  const ids = (heading) => city.routesAtStopHeading('b', heading).map((r) => r.id).sort();
  assert.deepEqual(ids('north'), ['bus', 'n1', 'n2']); // the bus is listed either way
  assert.deepEqual(ids('south'), ['bus', 's1']);
  assert.equal(city.stops.get('b').kind, 'train');
  assert.equal(city.routes.get('n1').label, '🚆');
});
