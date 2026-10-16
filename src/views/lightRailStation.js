// The light rail stop panel: what opens when a light rail stop is tapped on the home map.
// Docs: docs/user-flows.md#light-rail-stops
// @req REQ-LIGHT-1
//
// Its own place in the code, so the light rail can be changed apart from trains. For now it
// works like the train station panel (trainStation.js), with its own words: a timetable,
// a From / To search between light rail stops, the lines on the map only on request, and
// one tram at a time from the timetable.

import { t } from '../i18n.js';
import { openRailStation } from './trainStation.js';

export const LIGHT_RAIL = {
  kind: 'light',
  icon: '🚈',
  boardTitle: () => t('Light rail from this stop'),
  onMapButton: () => t('🗺 See all light rail lines through this stop on the map'),
  offMapButton: () => t('Hide the light rail from the map'),
  searchTitle: () => t('Light rail from… to…'),
  toPlaceholder: () => t('Destination stop'),
  noneToday: () => t('No more light rail from this stop today.'),
  noTrips: () => t('No direct light rail between these stops for the rest of today.'),
  notRunning: () => t('No live signal from this tram right now. It shows on the map while it runs.'),
};

export const openLightRailStation = (args) => openRailStation({ ...args, rail: LIGHT_RAIL });
