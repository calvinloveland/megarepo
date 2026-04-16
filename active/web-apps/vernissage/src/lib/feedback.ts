import { timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NextRequest } from 'next/server';

const execFileAsync = promisify(execFile);
const initializationPromises = new Map<string, Promise<void>>();

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
  version: string;
  git_commit: string;
  submitted_by_handle: string | null;
  submitted_by_name: string | null;
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

type SqliteFeedbackRow = Omit<FeedbackEntry, 'filename' | 'id' | 'addressed_timestamp'> & {
  id: string;
  addressed: number | boolean;
  addressed_timestamp: string | null;
};

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
  return {
    ...row,
    addressed: row.addressed === true || Number(row.addressed) === 1,
    filename: feedbackFilename(row.id),
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
      version,
      git_commit,
      submitted_by_handle,
      submitted_by_name,
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
      ${sqliteString(entry.version)},
      ${sqliteString(entry.git_commit)},
      ${sqliteNullableString(entry.submitted_by_handle)},
      ${sqliteNullableString(entry.submitted_by_name)},
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
      const payload = JSON.parse(raw) as FeedbackEntry;
      const id = feedbackIdFromFilename(filename);
      if (!id) {
        continue;
      }

      await runSql(
        databasePath,
        insertFeedbackSql({
          ...payload,
          id,
          submitted_by_handle: payload.submitted_by_handle ?? null,
          submitted_by_name: payload.submitted_by_name ?? null,
          addressed: payload.addressed ?? addressed
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
          version TEXT NOT NULL,
          git_commit TEXT NOT NULL,
          submitted_by_handle TEXT,
          submitted_by_name TEXT,
          addressed_by_commit TEXT,
          addressed INTEGER NOT NULL DEFAULT 0,
          addressed_timestamp TEXT
        );
        CREATE INDEX IF NOT EXISTS feedback_records_addressed_server_timestamp_idx
        ON feedback_records (addressed, server_timestamp DESC);
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
  const { databasePath } = await ensureFeedbackStorage(projectRoot);
  const rows = await queryJson<SqliteFeedbackRow>(
    databasePath,
    `
      SELECT
        id,
        feedback_text,
        selected_element,
        app,
        page_path,
        page_title,
        design,
        timestamp,
        server_timestamp,
        version,
        git_commit,
        submitted_by_handle,
        submitted_by_name,
        addressed_by_commit,
        addressed,
        addressed_timestamp
      FROM feedback_records
      WHERE addressed = ${sqliteBoolean(addressed)}
      ORDER BY server_timestamp DESC;
    `
  );

  return rows.map(asFeedbackEntry);
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

function safeCompare(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function requireFeedbackAuth(request: NextRequest, appName: string) {
  const username = process.env.FEEDBACK_ADMIN_USERNAME?.trim() ?? '';
  const password = process.env.FEEDBACK_ADMIN_PASSWORD ?? '';

  if (!username || !password) {
    return new Response('Feedback auth is not configured', { status: 503 });
  }

  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': `Basic realm="${appName} Feedback"` }
    });
  }

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  const providedUsername = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const providedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

  if (!safeCompare(username, providedUsername) || !safeCompare(password, providedPassword)) {
    return new Response('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': `Basic realm="${appName} Feedback"` }
    });
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
  const entry: FeedbackEntry = {
    id,
    ...submission,
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

export async function moveFeedbackToAddressed(
  feedbackId: string,
  addressedByCommit: string | null,
  projectRoot = process.cwd()
) {
  const { databasePath } = await ensureFeedbackStorage(projectRoot);
  const existingRows = await queryJson<SqliteFeedbackRow>(
    databasePath,
    `
      SELECT
        id,
        feedback_text,
        selected_element,
        app,
        page_path,
        page_title,
        design,
        timestamp,
        server_timestamp,
        version,
        git_commit,
        submitted_by_handle,
        submitted_by_name,
        addressed_by_commit,
        addressed,
        addressed_timestamp
      FROM feedback_records
      WHERE id = ${sqliteString(feedbackId)}
      LIMIT 1;
    `
  );

  if (existingRows.length === 0) {
    const error = new Error('Feedback entry not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  }

  const addressedTimestamp = new Date().toISOString();
  await runSql(
    databasePath,
    `
      UPDATE feedback_records
      SET
        addressed = 1,
        addressed_timestamp = ${sqliteString(addressedTimestamp)},
        addressed_by_commit = ${sqliteNullableString(addressedByCommit)}
      WHERE id = ${sqliteString(feedbackId)};
    `
  );

  return asFeedbackEntry({
    ...existingRows[0],
    addressed: true,
    addressed_timestamp: addressedTimestamp,
    addressed_by_commit: addressedByCommit
  });
}
