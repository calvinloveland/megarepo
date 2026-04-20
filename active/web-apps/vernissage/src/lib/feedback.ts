import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const initializationPromises = new Map<string, Promise<void>>();

export const feedbackStatuses = ['open', 'planned', 'in_progress', 'shipped'] as const;

export type FeedbackStatus = (typeof feedbackStatuses)[number];

export type FeedbackEntry = {
  id?: string;
  filename?: string;
  feedback_text: string;
  selected_element: string | null;
  app: string;
  page_path: string | null;
  page_title: string | null;
  design: string;
  timestamp: string | null;
  server_timestamp: string;
  updated_timestamp?: string;
  version: string;
  git_commit: string;
  submitted_by_handle: string | null;
  submitted_by_name: string | null;
  tracking_token: string | null;
  status: FeedbackStatus;
  status_note: string | null;
  assigned_to_handle: string | null;
  assigned_to_name: string | null;
  addressed_by_commit: string | null;
  addressed: boolean;
  addressed_timestamp?: string;
};

export type FeedbackSubmission = {
  feedback_text: string;
  selected_element: string | null;
  app: string;
  page_path: string | null;
  page_title: string | null;
  design: string;
  timestamp: string | null;
  server_timestamp: string;
  version: string;
  git_commit: string;
  submitted_by_handle: string | null;
  submitted_by_name: string | null;
};

export type FeedbackUpdateInput = {
  status?: FeedbackStatus;
  status_note?: string | null;
  assigned_to_handle?: string | null;
  addressed_by_commit?: string | null;
};

type SqliteFeedbackRow = Omit<FeedbackEntry, 'filename' | 'id' | 'addressed_timestamp' | 'updated_timestamp'> & {
  id: string;
  updated_timestamp: string | null;
  addressed: number | boolean;
  addressed_timestamp: string | null;
};

const feedbackStatusSet = new Set<FeedbackStatus>(feedbackStatuses);
const feedbackSelectColumnsSql = `
  id,
  feedback_text,
  selected_element,
  app,
  page_path,
  page_title,
  design,
  timestamp,
  server_timestamp,
  updated_timestamp,
  version,
  git_commit,
  submitted_by_handle,
  submitted_by_name,
  tracking_token,
  status,
  status_note,
  assigned_to_handle,
  assigned_to_name,
  addressed_by_commit,
  addressed,
  addressed_timestamp
`;

export function feedbackStoragePaths(projectRoot = process.cwd()) {
  const feedbackDir = path.join(path.dirname(feedbackDatabasePath(projectRoot)), 'feedback');
  const addressedDir = path.join(feedbackDir, 'addressed');
  return { feedbackDir, addressedDir };
}

export function feedbackDatabasePath(projectRoot = process.cwd()) {
  const configuredUrl = process.env.FEEDBACK_DATABASE_URL?.trim();
  if (configuredUrl?.startsWith('file:')) {
    const databaseTarget = configuredUrl.slice('file:'.length);
    if (!databaseTarget) {
      return path.join(projectRoot, 'data', 'vernissage-feedback.db');
    }
    return path.isAbsolute(databaseTarget)
      ? databaseTarget
      : path.resolve(projectRoot, databaseTarget);
  }

  return path.join(projectRoot, 'data', 'vernissage-feedback.db');
}

function sqliteString(value: string) {
  return `'${value.replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}

function sqliteNullableString(value: string | null | undefined) {
  return value == null ? 'NULL' : sqliteString(value);
}

function sqliteBoolean(value: boolean) {
  return value ? '1' : '0';
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function normalizeFeedbackHandle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

export function isFeedbackStatus(value: string): value is FeedbackStatus {
  return feedbackStatusSet.has(value as FeedbackStatus);
}

export function parseFeedbackStatus(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return isFeedbackStatus(normalized) ? normalized : null;
}

function normalizeFeedbackStatus(value: string | null | undefined): FeedbackStatus {
  return parseFeedbackStatus(value) ?? 'open';
}

export function formatFeedbackStatusLabel(status: FeedbackStatus) {
  switch (status) {
    case 'planned':
      return 'Planned';
    case 'in_progress':
      return 'In progress';
    case 'shipped':
      return 'Shipped';
    default:
      return 'Open';
  }
}

export function feedbackTrackingPath(token: string) {
  const trimmed = token.trim();
  return trimmed ? `/feedback/updates?token=${encodeURIComponent(trimmed)}` : '/feedback/updates';
}

export function isFeedbackAdminHandle(handle: string | undefined | null) {
  const allowedHandles = new Set(
    (process.env.FEEDBACK_ADMIN_HANDLES ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  const normalizedHandle = handle?.trim().toLowerCase() ?? '';
  return Boolean(normalizedHandle && allowedHandles.has(normalizedHandle));
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

function asFeedbackEntry(row: SqliteFeedbackRow): FeedbackEntry {
  const status = normalizeFeedbackStatus(row.status);
  return {
    ...row,
    status,
    addressed: status === 'shipped' || row.addressed === true || Number(row.addressed) === 1,
    filename: feedbackFilename(row.id),
    updated_timestamp: row.updated_timestamp ?? row.server_timestamp,
    addressed_timestamp: row.addressed_timestamp ?? undefined
  };
}

function insertFeedbackSql(entry: FeedbackEntry) {
  return `
    INSERT OR IGNORE INTO feedback_records (
      id,
      feedback_text,
      selected_element,
      app,
      page_path,
      page_title,
      design,
      timestamp,
      server_timestamp,
      updated_timestamp,
      version,
      git_commit,
      submitted_by_handle,
      submitted_by_name,
      tracking_token,
      status,
      status_note,
      assigned_to_handle,
      assigned_to_name,
      addressed_by_commit,
      addressed,
      addressed_timestamp
    ) VALUES (
      ${sqliteString(entry.id ?? '')},
      ${sqliteString(entry.feedback_text)},
      ${sqliteNullableString(entry.selected_element)},
      ${sqliteString(entry.app)},
      ${sqliteNullableString(entry.page_path)},
      ${sqliteNullableString(entry.page_title)},
      ${sqliteString(entry.design)},
      ${sqliteNullableString(entry.timestamp)},
      ${sqliteString(entry.server_timestamp)},
      ${sqliteString(entry.updated_timestamp ?? entry.server_timestamp)},
      ${sqliteString(entry.version)},
      ${sqliteString(entry.git_commit)},
      ${sqliteNullableString(entry.submitted_by_handle)},
      ${sqliteNullableString(entry.submitted_by_name)},
      ${sqliteNullableString(entry.tracking_token)},
      ${sqliteString(normalizeFeedbackStatus(entry.status))},
      ${sqliteNullableString(entry.status_note)},
      ${sqliteNullableString(entry.assigned_to_handle)},
      ${sqliteNullableString(entry.assigned_to_name)},
      ${sqliteNullableString(entry.addressed_by_commit)},
      ${sqliteBoolean(entry.addressed)},
      ${sqliteNullableString(entry.addressed_timestamp ?? null)}
    );
  `;
}

async function migrateLegacyFeedback(projectRoot: string) {
  const databasePath = feedbackDatabasePath(projectRoot);
  const { feedbackDir, addressedDir } = feedbackStoragePaths(projectRoot);
  const legacyDirectories = [
    { directory: feedbackDir, addressed: false },
    { directory: addressedDir, addressed: true }
  ];

  for (const { directory, addressed } of legacyDirectories) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const filename of entries) {
      if (!filename.startsWith('feedback_') || !filename.endsWith('.json')) {
        continue;
      }

      const raw = await fs.readFile(path.join(directory, filename), 'utf8');
      const payload = JSON.parse(raw) as Partial<FeedbackEntry>;
      const id = feedbackIdFromFilename(filename);
      if (!id) {
        continue;
      }

      const status = normalizeFeedbackStatus(payload.status ?? (addressed ? 'shipped' : 'open'));
      await runSql(
        databasePath,
        insertFeedbackSql({
          id,
          feedback_text: payload.feedback_text ?? '',
          selected_element: payload.selected_element ?? null,
          app: payload.app ?? 'Vernissage',
          page_path: payload.page_path ?? null,
          page_title: payload.page_title ?? null,
          design: payload.design ?? 'gilded-manuscript',
          timestamp: payload.timestamp ?? null,
          server_timestamp: payload.server_timestamp ?? new Date().toISOString(),
          updated_timestamp: payload.updated_timestamp ?? payload.addressed_timestamp ?? payload.server_timestamp ?? new Date().toISOString(),
          version: payload.version ?? 'unknown',
          git_commit: payload.git_commit ?? 'unknown',
          submitted_by_handle: payload.submitted_by_handle ?? null,
          submitted_by_name: payload.submitted_by_name ?? null,
          tracking_token: payload.tracking_token ?? null,
          status,
          status_note: payload.status_note ?? null,
          assigned_to_handle: payload.assigned_to_handle ?? null,
          assigned_to_name: payload.assigned_to_name ?? null,
          addressed_by_commit: payload.addressed_by_commit ?? null,
          addressed: status === 'shipped',
          addressed_timestamp: payload.addressed_timestamp ?? undefined
        })
      );
    }
  }
}

async function ensureFeedbackColumns(databasePath: string) {
  const columns = await queryJson<{ name: string }>(databasePath, 'PRAGMA table_info(feedback_records);');
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('submitted_by_handle')) {
    await runSql(databasePath, 'ALTER TABLE feedback_records ADD COLUMN submitted_by_handle TEXT;');
  }

  if (!columnNames.has('submitted_by_name')) {
    await runSql(databasePath, 'ALTER TABLE feedback_records ADD COLUMN submitted_by_name TEXT;');
  }

  if (!columnNames.has('tracking_token')) {
    await runSql(databasePath, 'ALTER TABLE feedback_records ADD COLUMN tracking_token TEXT;');
  }

  if (!columnNames.has('status')) {
    await runSql(databasePath, "ALTER TABLE feedback_records ADD COLUMN status TEXT;");
  }
  await runSql(
    databasePath,
    "UPDATE feedback_records SET status = CASE WHEN addressed = 1 THEN 'shipped' ELSE 'open' END WHERE status IS NULL OR TRIM(status) = '';"
  );

  if (!columnNames.has('status_note')) {
    await runSql(databasePath, 'ALTER TABLE feedback_records ADD COLUMN status_note TEXT;');
  }

  if (!columnNames.has('assigned_to_handle')) {
    await runSql(databasePath, 'ALTER TABLE feedback_records ADD COLUMN assigned_to_handle TEXT;');
  }

  if (!columnNames.has('assigned_to_name')) {
    await runSql(databasePath, 'ALTER TABLE feedback_records ADD COLUMN assigned_to_name TEXT;');
  }

  if (!columnNames.has('updated_timestamp')) {
    await runSql(databasePath, 'ALTER TABLE feedback_records ADD COLUMN updated_timestamp TEXT;');
  }
  await runSql(
    databasePath,
    'UPDATE feedback_records SET updated_timestamp = COALESCE(updated_timestamp, addressed_timestamp, server_timestamp) WHERE updated_timestamp IS NULL OR TRIM(updated_timestamp) = \'\';'
  );
}

async function readFeedbackRows(whereClause: string, orderClause: string, projectRoot = process.cwd()) {
  const { databasePath } = await ensureFeedbackStorage(projectRoot);
  const rows = await queryJson<SqliteFeedbackRow>(
    databasePath,
    `
      SELECT
        ${feedbackSelectColumnsSql}
      FROM feedback_records
      ${whereClause}
      ${orderClause};
    `
  );

  return rows.map(asFeedbackEntry);
}

async function readFeedbackEntryById(feedbackId: string, projectRoot = process.cwd()) {
  const entries = await readFeedbackRows(
    `WHERE id = ${sqliteString(feedbackId)}`,
    'LIMIT 1',
    projectRoot
  );
  return entries[0] ?? null;
}

async function resolveAssignedMember(handle: string | null | undefined) {
  const normalized = normalizeOptionalText(handle) ? normalizeFeedbackHandle(handle ?? '') : '';
  if (!normalized) {
    return {
      assigned_to_handle: null,
      assigned_to_name: null
    };
  }

  const { getPersistedMemberProfile } = await import('./live-data');
  const member = await getPersistedMemberProfile(normalized);
  return {
    assigned_to_handle: normalized,
    assigned_to_name: member?.displayName ?? normalized
  };
}

export async function ensureFeedbackStorage(projectRoot = process.cwd()) {
  const { feedbackDir, addressedDir } = feedbackStoragePaths(projectRoot);
  const databasePath = feedbackDatabasePath(projectRoot);

  await fs.mkdir(feedbackDir, { recursive: true });
  await fs.mkdir(addressedDir, { recursive: true });
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  const existingInitialization = initializationPromises.get(databasePath);
  if (existingInitialization) {
    await existingInitialization;
    return { feedbackDir, addressedDir, databasePath };
  }

  const initialize = (async () => {
    await runSql(
      databasePath,
      `
        CREATE TABLE IF NOT EXISTS feedback_records (
          id TEXT NOT NULL PRIMARY KEY,
          feedback_text TEXT NOT NULL,
          selected_element TEXT,
          app TEXT NOT NULL,
          page_path TEXT,
          page_title TEXT,
          design TEXT NOT NULL,
          timestamp TEXT,
          server_timestamp TEXT NOT NULL,
          updated_timestamp TEXT,
          version TEXT NOT NULL,
          git_commit TEXT NOT NULL,
          submitted_by_handle TEXT,
          submitted_by_name TEXT,
          tracking_token TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          status_note TEXT,
          assigned_to_handle TEXT,
          assigned_to_name TEXT,
          addressed_by_commit TEXT,
          addressed INTEGER NOT NULL DEFAULT 0,
          addressed_timestamp TEXT
        );
        CREATE INDEX IF NOT EXISTS feedback_records_addressed_server_timestamp_idx
        ON feedback_records (addressed, server_timestamp DESC);
        CREATE INDEX IF NOT EXISTS feedback_records_status_updated_timestamp_idx
        ON feedback_records (status, updated_timestamp DESC);
        CREATE INDEX IF NOT EXISTS feedback_records_submitted_by_handle_updated_timestamp_idx
        ON feedback_records (submitted_by_handle, updated_timestamp DESC);
        CREATE INDEX IF NOT EXISTS feedback_records_tracking_token_idx
        ON feedback_records (tracking_token);
      `
    );
    await ensureFeedbackColumns(databasePath);
    await migrateLegacyFeedback(projectRoot);
  })();

  initializationPromises.set(databasePath, initialize);
  try {
    await initialize;
  } catch (error) {
    initializationPromises.delete(databasePath);
    throw error;
  }

  return { feedbackDir, addressedDir, databasePath };
}

export async function readFeedbackEntries(addressed: boolean, projectRoot = process.cwd()) {
  return readFeedbackRows(
    addressed ? "WHERE status = 'shipped'" : "WHERE status != 'shipped'",
    'ORDER BY updated_timestamp DESC, server_timestamp DESC',
    projectRoot
  );
}

export async function readFeedbackEntriesBySubmitterHandle(handle: string, projectRoot = process.cwd()) {
  const normalizedHandle = normalizeFeedbackHandle(handle);
  if (!normalizedHandle) {
    return [] as FeedbackEntry[];
  }

  return readFeedbackRows(
    `WHERE submitted_by_handle = ${sqliteString(normalizedHandle)}`,
    'ORDER BY updated_timestamp DESC, server_timestamp DESC',
    projectRoot
  );
}

export async function readFeedbackEntryByTrackingToken(token: string, projectRoot = process.cwd()) {
  const normalizedToken = normalizeOptionalText(token);
  if (!normalizedToken) {
    return null;
  }

  const entries = await readFeedbackRows(
    `WHERE tracking_token = ${sqliteString(normalizedToken)}`,
    'LIMIT 1',
    projectRoot
  );
  return entries[0] ?? null;
}

export function normalizePagePath(rawValue: string) {
  const value = rawValue.trim();
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    return parsed.search ? `${parsed.pathname}${parsed.search}` : parsed.pathname || '/';
  } catch {
    return value;
  }
}

export function requireFeedbackAdminHandle(handle: string | undefined | null) {
  const allowedHandles = new Set(
    (process.env.FEEDBACK_ADMIN_HANDLES ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!allowedHandles.size) {
    return new Response('Feedback admin is not configured', { status: 503 });
  }

  if (!isFeedbackAdminHandle(handle)) {
    return new Response('Forbidden', { status: 403 });
  }

  return null;
}

export async function resolveGitCommit(projectRoot = process.cwd()) {
  const configured = process.env.GIT_COMMIT?.trim();
  if (configured) {
    return configured;
  }

  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%h'], {
      cwd: projectRoot,
      timeout: 1000
    });
    return stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function feedbackFilename(id: string) {
  return `feedback_${id}.json`;
}

export function feedbackIdFromFilename(filename: string) {
  const trimmed = filename.trim();
  if (!trimmed.startsWith('feedback_') || !trimmed.endsWith('.json')) {
    return '';
  }
  return trimmed.replace(/^feedback_/, '').replace(/\.json$/, '');
}

export async function createFeedbackEntry(
  submission: FeedbackSubmission,
  addressedByCommit: string | null,
  projectRoot = process.cwd()
) {
  const { databasePath } = await ensureFeedbackStorage(projectRoot);
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 20);
  const trackingToken = randomUUID().replace(/-/g, '');
  const entry: FeedbackEntry = {
    id,
    ...submission,
    updated_timestamp: submission.server_timestamp,
    tracking_token: trackingToken,
    status: 'open',
    status_note: null,
    assigned_to_handle: null,
    assigned_to_name: null,
    addressed: false,
    addressed_by_commit: addressedByCommit,
    addressed_timestamp: undefined
  };

  await runSql(databasePath, insertFeedbackSql(entry));
  return {
    ...entry,
    filename: feedbackFilename(id)
  };
}

export async function updateFeedbackEntry(
  feedbackId: string,
  updates: FeedbackUpdateInput,
  projectRoot = process.cwd()
) {
  const { databasePath } = await ensureFeedbackStorage(projectRoot);
  const existing = await readFeedbackEntryById(feedbackId, projectRoot);
  if (!existing) {
    const error = new Error('Feedback entry not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  }

  const status = updates.status ?? existing.status;
  const note = updates.status_note === undefined ? existing.status_note : normalizeOptionalText(updates.status_note);
  const assignee =
    updates.assigned_to_handle === undefined
      ? {
          assigned_to_handle: existing.assigned_to_handle,
          assigned_to_name: existing.assigned_to_name
        }
      : await resolveAssignedMember(updates.assigned_to_handle);
  const updatedTimestamp = new Date().toISOString();
  const addressedTimestamp = status === 'shipped' ? existing.addressed_timestamp ?? updatedTimestamp : null;
  const addressedByCommit =
    status === 'shipped'
      ? updates.addressed_by_commit === undefined
        ? existing.addressed_by_commit
        : normalizeOptionalText(updates.addressed_by_commit)
      : null;

  await runSql(
    databasePath,
    `
      UPDATE feedback_records
      SET
        status = ${sqliteString(status)},
        status_note = ${sqliteNullableString(note)},
        assigned_to_handle = ${sqliteNullableString(assignee.assigned_to_handle)},
        assigned_to_name = ${sqliteNullableString(assignee.assigned_to_name)},
        updated_timestamp = ${sqliteString(updatedTimestamp)},
        addressed = ${sqliteBoolean(status === 'shipped')},
        addressed_timestamp = ${sqliteNullableString(addressedTimestamp)},
        addressed_by_commit = ${sqliteNullableString(addressedByCommit)}
      WHERE id = ${sqliteString(feedbackId)};
    `
  );

  return {
    ...existing,
    status,
    status_note: note,
    assigned_to_handle: assignee.assigned_to_handle,
    assigned_to_name: assignee.assigned_to_name,
    updated_timestamp: updatedTimestamp,
    addressed: status === 'shipped',
    addressed_timestamp: addressedTimestamp ?? undefined,
    addressed_by_commit: addressedByCommit
  } satisfies FeedbackEntry;
}

export async function moveFeedbackToAddressed(
  feedbackId: string,
  addressedByCommit: string | null,
  projectRoot = process.cwd()
) {
  return updateFeedbackEntry(
    feedbackId,
    {
      status: 'shipped',
      addressed_by_commit: addressedByCommit
    },
    projectRoot
  );
}
