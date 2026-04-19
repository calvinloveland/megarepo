import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AnalyticsEventPayload, AnalyticsEventType, AnalyticsPageType, AnalyticsTargetType } from '@/src/lib/analytics-events';

const execFileAsync = promisify(execFile);
const initializationPromises = new Map<string, Promise<void>>();
const unavailableAnalyticsPaths = new Set<string>();

type AnalyticsSummaryCount = {
  key: string | null;
  count: number;
};

type AnalyticsTargetSummaryCount = {
  target_type: string | null;
  target_slug: string | null;
  count: number;
};

function sqliteString(value: string) {
  return `'${value.replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}

function sqliteNullableString(value: string | null | undefined) {
  return value == null ? 'NULL' : sqliteString(value);
}

async function runSql(databasePath: string, sql: string) {
  await execFileAsync('sqlite3', [databasePath, sql], {
    maxBuffer: 1024 * 1024 * 10
  });
}

async function queryJson<T>(databasePath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync('sqlite3', ['-json', databasePath, sql], {
    maxBuffer: 1024 * 1024 * 10
  });

  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  return JSON.parse(trimmed) as T[];
}

export function analyticsDatabasePath(projectRoot = process.cwd()) {
  const configuredUrl = process.env.ANALYTICS_DATABASE_URL?.trim();
  if (configuredUrl?.startsWith('file:')) {
    const databaseTarget = configuredUrl.slice('file:'.length);
    if (!databaseTarget) {
      return path.join(projectRoot, 'data', 'vernissage-analytics.db');
    }
    return path.isAbsolute(databaseTarget)
      ? databaseTarget
      : path.resolve(projectRoot, databaseTarget);
  }

  return path.join(projectRoot, 'data', 'vernissage-analytics.db');
}

export async function ensureAnalyticsStorage(projectRoot = process.cwd()) {
  const databasePath = analyticsDatabasePath(projectRoot);
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  const existingInitialization = initializationPromises.get(databasePath);
  if (existingInitialization) {
    await existingInitialization;
    return databasePath;
  }

  const initialize = (async () => {
    await runSql(
      databasePath,
      `
        CREATE TABLE IF NOT EXISTS analytics_events (
          id TEXT NOT NULL PRIMARY KEY,
          event_type TEXT NOT NULL,
          page_type TEXT,
          path TEXT,
          target_type TEXT,
          target_slug TEXT,
          session_id TEXT,
          member_handle TEXT,
          metadata_json TEXT,
          occurred_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS analytics_events_event_type_occurred_at_idx
        ON analytics_events (event_type, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS analytics_events_page_type_occurred_at_idx
        ON analytics_events (page_type, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS analytics_events_path_occurred_at_idx
        ON analytics_events (path, occurred_at DESC);
      `
    );
  })();

  initializationPromises.set(databasePath, initialize);
  try {
    await initialize;
  } catch (error) {
    initializationPromises.delete(databasePath);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      warnAnalyticsUnavailable(databasePath);
      return null;
    }
    throw error;
  }

  return databasePath;
}

export async function createAnalyticsEvent(payload: AnalyticsEventPayload, projectRoot = process.cwd()) {
  const databasePath = await ensureAnalyticsStorage(projectRoot);
  if (!databasePath) {
    return;
  }

  const entry = {
    id: randomUUID().replace(/-/g, ''),
    eventType: payload.eventType,
    pageType: payload.pageType ?? null,
    path: payload.path ?? null,
    targetType: payload.targetType ?? null,
    targetSlug: payload.targetSlug ?? null,
    sessionId: payload.sessionId ?? null,
    memberHandle: payload.memberHandle?.trim().toLowerCase() || null,
    metadataJson: payload.metadata ? JSON.stringify(payload.metadata) : null,
    occurredAt: payload.occurredAt ?? new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  await runSql(
    databasePath,
    `
      INSERT INTO analytics_events (
        id,
        event_type,
        page_type,
        path,
        target_type,
        target_slug,
        session_id,
        member_handle,
        metadata_json,
        occurred_at,
        created_at
      ) VALUES (
        ${sqliteString(entry.id)},
        ${sqliteString(entry.eventType)},
        ${sqliteNullableString(entry.pageType)},
        ${sqliteNullableString(entry.path)},
        ${sqliteNullableString(entry.targetType)},
        ${sqliteNullableString(entry.targetSlug)},
        ${sqliteNullableString(entry.sessionId)},
        ${sqliteNullableString(entry.memberHandle)},
        ${sqliteNullableString(entry.metadataJson)},
        ${sqliteString(entry.occurredAt)},
        ${sqliteString(entry.createdAt)}
      );
    `
  );
}

export async function recordAnalyticsEvent(payload: AnalyticsEventPayload, projectRoot = process.cwd()) {
  try {
    await createAnalyticsEvent(payload, projectRoot);
  } catch (error) {
    console.error('Failed to record analytics event', error);
  }
}

export async function readAnalyticsSummary(days: number = 7, projectRoot = process.cwd()) {
  const databasePath = await ensureAnalyticsStorage(projectRoot);
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(90, Math.trunc(days))) : 7;
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const sinceSql = sqliteString(since);
  if (!databasePath) {
    return {
      days: safeDays,
      since,
      totals: {
        totalEvents: 0,
        uniqueSessions: 0,
        uniqueMembers: 0
      },
      eventCounts: [],
      pageTypeCounts: [],
      topPaths: [],
      topTargets: []
    };
  }

  const totals = await queryJson<{ total_events: number; unique_sessions: number; unique_members: number }>(
    databasePath,
    `
      SELECT
        COUNT(*) AS total_events,
        COUNT(DISTINCT session_id) AS unique_sessions,
        COUNT(DISTINCT member_handle) AS unique_members
      FROM analytics_events
      WHERE occurred_at >= ${sinceSql};
    `
  );

  const eventCounts = await queryJson<AnalyticsSummaryCount>(
    databasePath,
    `
      SELECT event_type AS key, COUNT(*) AS count
      FROM analytics_events
      WHERE occurred_at >= ${sinceSql}
      GROUP BY event_type
      ORDER BY count DESC, event_type ASC;
    `
  );

  const pageTypeCounts = await queryJson<AnalyticsSummaryCount>(
    databasePath,
    `
      SELECT page_type AS key, COUNT(*) AS count
      FROM analytics_events
      WHERE occurred_at >= ${sinceSql} AND page_type IS NOT NULL
      GROUP BY page_type
      ORDER BY count DESC, page_type ASC;
    `
  );

  const topPaths = await queryJson<AnalyticsSummaryCount>(
    databasePath,
    `
      SELECT path AS key, COUNT(*) AS count
      FROM analytics_events
      WHERE occurred_at >= ${sinceSql} AND path IS NOT NULL
      GROUP BY path
      ORDER BY count DESC, path ASC
      LIMIT 15;
    `
  );

  const topTargets = await queryJson<AnalyticsTargetSummaryCount>(
    databasePath,
    `
      SELECT target_type, target_slug, COUNT(*) AS count
      FROM analytics_events
      WHERE occurred_at >= ${sinceSql} AND target_type IS NOT NULL AND target_slug IS NOT NULL
      GROUP BY target_type, target_slug
      ORDER BY count DESC, target_type ASC, target_slug ASC
      LIMIT 15;
    `
  );

  return {
    days: safeDays,
    since,
    totals: {
      totalEvents: totals[0]?.total_events ?? 0,
      uniqueSessions: totals[0]?.unique_sessions ?? 0,
      uniqueMembers: totals[0]?.unique_members ?? 0
    },
    eventCounts: eventCounts.map((row) => ({
      eventType: (row.key ?? 'unknown') as AnalyticsEventType,
      count: row.count
    })),
    pageTypeCounts: pageTypeCounts.map((row) => ({
      pageType: (row.key ?? 'other') as AnalyticsPageType,
      count: row.count
    })),
    topPaths: topPaths.map((row) => ({
      path: row.key ?? '/',
      count: row.count
    })),
    topTargets: topTargets.map((row) => ({
      targetType: (row.target_type ?? 'artist') as AnalyticsTargetType,
      targetSlug: row.target_slug ?? '',
      count: row.count
    }))
  };
}

function warnAnalyticsUnavailable(databasePath: string) {
  if (unavailableAnalyticsPaths.has(databasePath)) {
    return;
  }

  unavailableAnalyticsPaths.add(databasePath);
  console.warn(`Analytics storage disabled because sqlite3 is unavailable for ${databasePath}.`);
}
