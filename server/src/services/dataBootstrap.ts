import db from '../db';
import { syncIncidents } from './ndmaService';
import { v4 as uuidv4 } from 'uuid';

const fallbackZones = [
  { name: 'Dehradun Flood Zone', lat: 30.32, lng: 78.03, severityScore: 5, populationDensity: 10000, roadAccessibility: 5 },
  { name: 'Haridwar Flood Zone', lat: 30.08, lng: 78.29, severityScore: 5, populationDensity: 10000, roadAccessibility: 5 },
  { name: 'Rishikesh Flood Zone', lat: 29.94, lng: 78.16, severityScore: 5, populationDensity: 10000, roadAccessibility: 5 }
];

const fallbackDepots = [
  { name: 'Dehradun Relief Depot', lat: 30.31, lng: 78.04, food: 0, medicine: 0, shelterKits: 0, rescueTeams: 0 },
  { name: 'Haridwar Relief Depot', lat: 29.93, lng: 78.15, food: 0, medicine: 0, shelterKits: 0, rescueTeams: 0 }
];

function repairNamedFallbacks(): void {
  const placeholderZones = db.prepare(`
    SELECT id
    FROM zones
    WHERE data_source = 'placeholder' OR name LIKE 'Zone % (Placeholder)'
    ORDER BY lastUpdated ASC
  `).all() as Array<{ id: string }>;

  placeholderZones.forEach((zone, index) => {
    const fallback = fallbackZones[index % fallbackZones.length];
    db.prepare(`
      UPDATE zones
      SET name = ?, lat = ?, lng = ?, severityScore = ?, populationDensity = ?, roadAccessibility = ?, data_source = 'manual'
      WHERE id = ?
    `).run(
      fallback.name,
      fallback.lat,
      fallback.lng,
      fallback.severityScore,
      fallback.populationDensity,
      fallback.roadAccessibility,
      zone.id
    );
  });

  const placeholderDepots = db.prepare(`
    SELECT id
    FROM depots
    WHERE update_source = 'placeholder' OR name LIKE 'Depot % (Placeholder)'
    ORDER BY last_coordinator_update ASC, rowid ASC
  `).all() as Array<{ id: string }>;

  placeholderDepots.forEach((depot, index) => {
    const fallback = fallbackDepots[index % fallbackDepots.length];
    db.prepare(`
      UPDATE depots
      SET name = ?, lat = ?, lng = ?, update_source = 'manual'
      WHERE id = ?
    `).run(fallback.name, fallback.lat, fallback.lng, depot.id);
  });
}

export async function bootstrapData(): Promise<void> {
  repairNamedFallbacks();

  // 1. Check zones
  const zoneCount = (db.prepare('SELECT COUNT(*) as count FROM zones').get() as any).count;

  if (zoneCount === 0) {
    console.log('[Bootstrap] No zone data found. Running first-time API sync...');
    await syncIncidents();
    
    // Check if sync actually loaded anything
    const newCount = (db.prepare('SELECT COUNT(*) as count FROM zones').get() as any).count;
    if (newCount === 0) {
      console.warn('[Bootstrap] API sync failed to load zones. Inserting fallback named locations.');
      const now = Date.now();
      for (const p of fallbackZones) {
        db.prepare(`
          INSERT INTO zones (id, name, lat, lng, severityScore, populationDensity, roadAccessibility, priorityScore, lastUpdated, data_source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(uuidv4(), p.name, p.lat, p.lng, p.severityScore, p.populationDensity, p.roadAccessibility, now, 'manual');
      }
    }
  } else {
    // 3. App restart: Check last sync
    const lastSyncRow = db.prepare('SELECT last_api_sync FROM zones WHERE external_id IS NOT NULL ORDER BY last_api_sync DESC LIMIT 1').get() as any;
    const pollInterval = parseInt(process.env.POLL_INCIDENTS_MS || '900000');
    
    if (!lastSyncRow || (Date.now() - lastSyncRow.last_api_sync) > pollInterval) {
      console.log('[Bootstrap] Data is stale. Starting background sync...');
      syncIncidents().catch(err => console.error('[Bootstrap] Background sync failed:', err));
    }
  }

  // 4. Check depots
  const depotCount = (db.prepare('SELECT COUNT(*) as count FROM depots').get() as any).count;
  if (depotCount === 0) {
    console.log('[Bootstrap] No depots found. Inserting fallback named locations.');
    for (const p of fallbackDepots) {
      db.prepare(`
        INSERT INTO depots (id, name, lat, lng, food, medicine, shelterKits, rescueTeams, update_source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), p.name, p.lat, p.lng, p.food, p.medicine, p.shelterKits, p.rescueTeams, 'manual');
    }
  }
}
