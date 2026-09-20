const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { randomUUID, createHash, timingSafeEqual } = require('crypto');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssm = new SSMClient({});

// single-user app: every item lives under the same fixed partition key
const USER_ID = 'me';

const TABLES = {
  badges: { name: process.env.BADGES_TABLE, idKey: 'badgeId' },
  articles: { name: process.env.ARTICLES_TABLE, idKey: 'articleId' },
};

// Site-wide settings are a single fixed row, not a collection — doesn't fit
// the TABLES/idKey list-of-many shape above, so it gets its own small
// GET/PUT branch instead of forcing it through that machinery.
const SETTINGS_TABLE = process.env.SETTINGS_TABLE;
const DEFAULT_SETTINGS = { timezone: 'America/Los_Angeles' };
// Mirrors web/src/timezone.js's TIMEZONE_OPTIONS values — kept in sync by
// hand since the frontend and this Lambda are separate packages. A bad value
// here would break the public page's date display for every visitor, not
// just the admin who set it, so it's worth validating rather than trusting
// the request body.
const VALID_TIMEZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'UTC'];

function isValidTimezone(tz) {
  return VALID_TIMEZONES.includes(tz);
}

exports.handler = async (event) => {
  // EventBridge Scheduler invokes the function directly (no API Gateway
  // envelope) for the nightly sync — everything below this expects a real
  // HTTP request, so branch off before touching event.requestContext.
  if (!event.requestContext) {
    const [badges, articles] = await Promise.all([syncBadges(), syncArticles()]);
    return { badges, articles };
  }

  const method = event.requestContext.http.method;
  // rawPath is not URL-decoded, so a %2F-encoded slash in a synced article's
  // ID (a Builder Center path like /content/abc) survives the split as part
  // of one segment instead of breaking the route — decode it back to the
  // real ID before using it as a DynamoDB key. No-op for badgeId/UUIDs.
  const [, resource, rawId] = event.rawPath.split('/');
  // A stray "%" isn't valid percent-encoding and makes decodeURIComponent
  // throw — this runs before the try below, so it would surface as a 502.
  let id;
  try {
    id = rawId && decodeURIComponent(rawId);
  } catch {
    return respond(400, { message: 'Invalid id' });
  }
  const table = TABLES[resource];

  if (resource === 'settings') {
    return handleSettings(method, event);
  }

  if (!table) {
    return respond(404, { message: 'Not found' });
  }

  try {
    if (method === 'POST' && resource === 'badges' && id === 'sync') {
      const synced = await syncBadges();
      return respond(200, { synced });
    }

    if (method === 'POST' && resource === 'articles' && id === 'sync') {
      const synced = await syncArticles();
      return respond(200, { synced });
    }

    if (method === 'POST' && resource === 'badges' && id === 'progress-sync') {
      return await progressSync(event);
    }

    if (method === 'GET') {
      return respond(200, await queryUserItems(table.name));
    }

    if (method === 'POST') {
      const body = parseBody(event);
      if (!body) return respond(400, { message: 'Body must be a JSON object' });
      if (resource === 'badges') {
        const existing = await findBadgeByName(body.name);
        if (existing) {
          const update = buildUpdateExpression(body, ['userId', 'badgeId']);
          if (update) {
            await client.send(
              new UpdateCommand({
                TableName: table.name,
                Key: { userId: USER_ID, badgeId: existing.badgeId },
                ...update,
              })
            );
          }
          return respond(200, { ...existing, ...body });
        }
      }
      const item = { ...body, userId: USER_ID, [table.idKey]: randomUUID() };
      await client.send(new PutCommand({ TableName: table.name, Item: item }));
      return respond(201, item);
    }

    if (method === 'PUT') {
      const body = parseBody(event);
      if (!body) return respond(400, { message: 'Body must be a JSON object' });
      const update = buildUpdateExpression(body, ['userId', table.idKey]);
      if (!update) {
        return respond(400, { message: 'No fields to update' });
      }
      await client.send(
        new UpdateCommand({
          TableName: table.name,
          Key: { userId: USER_ID, [table.idKey]: id },
          ...update,
        })
      );
      return respond(200, { ...body, userId: USER_ID, [table.idKey]: id });
    }

    if (method === 'DELETE') {
      await client.send(
        new DeleteCommand({
          TableName: table.name,
          Key: { userId: USER_ID, [table.idKey]: id },
        })
      );
      return respond(204, null);
    }

    return respond(405, { message: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return respond(500, { message: 'Internal error' });
  }
};

// Pulls earned badges from AWS Builder Center's public rewards API
// (found via DevTools — undocumented, unauthenticated, no stability
// guarantee) and upserts them into the Badges table, keyed by AWS's own
// badgeId so re-syncing overwrites rather than duplicates. Only covers
// earned badges — no public endpoint for in-progress badges was found,
// so those still need manual entry via the admin panel.
async function syncBadges() {
  const bpId = process.env.BUILDER_PROFILE_ID;
  let nextToken;
  let count = 0;
  const existing = await queryUserItems(TABLES.badges.name);

  do {
    const url = new URL('https://api.builder.aws.com/rms/badges');
    url.searchParams.set('bpId', bpId);
    url.searchParams.set('locale', 'en');
    url.searchParams.set('size', '50');
    if (nextToken) url.searchParams.set('next', nextToken);

    const res = await fetch(url, { headers: { 'builder-session-token': 'dummy' } });
    if (!res.ok) throw new Error(`Builder Center API returned ${res.status}`);
    const data = await res.json();

    for (const awarded of data.awardedBadgeList || []) {
      const item = {
        userId: USER_ID,
        badgeId: awarded.baseBadge.badgeId,
        name: awarded.baseBadge.displayName,
        status: 'earned',
        dateEarned: new Date(awarded.awardedDate * 1000).toISOString().slice(0, 10),
        updatedAt: new Date().toISOString(),
      };
      await client.send(new PutCommand({ TableName: TABLES.badges.name, Item: item }));
      count += 1;
      await removeStaleDuplicate(existing, item.name, item.badgeId);
    }
    nextToken = data.nextToken;
  } while (nextToken);

  return count;
}

// Pulls published articles from AWS Builder Center's public content API
// (same discovery method as syncBadges: found via DevTools, unauthenticated,
// no stability guarantee) and upserts them into the Articles table, keyed by
// Builder Center's own articleId so re-syncing overwrites rather than
// duplicates. Unlike badges, that ID is stable and known up front, so there's
// no name-matching reconciliation needed against manually-added entries.
async function syncArticles() {
  const bpId = process.env.BUILDER_PROFILE_ID;
  let cursor;
  let count = 0;

  do {
    const url = new URL(`https://api.builder.aws.com/cs/v2/articles/user/${bpId}`);
    url.searchParams.set('pageSize', '50');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, { headers: { 'builder-session-token': 'dummy' } });
    if (!res.ok) throw new Error(`Builder Center API returned ${res.status}`);
    const data = await res.json();

    for (const article of data.articles || []) {
      if (article.status !== 'LIVE') continue; // skip drafts, if this endpoint ever returns them
      const item = toArticleItem(article);
      if (!item) {
        console.warn('skipping an unusable article', article.articleId);
        continue;
      }
      await client.send(new PutCommand({ TableName: TABLES.articles.name, Item: item }));
      count += 1;
    }
    cursor = data.cursor;
  } while (cursor);

  return count;
}

// Maps one Builder Center article into this app's Articles item shape. Pure
// (no I/O) so it's unit-testable without mocking fetch/DynamoDB, same as
// buildUpdateExpression/isValidProgressItems below.
//
// This is third-party data, so it's checked rather than trusted. Returns null
// for an article that can't be stored or shown safely, and the caller skips it.
// DynamoDB's document client throws on an undefined attribute, so one article
// missing a field would otherwise abort the whole nightly sync.
const ARTICLE_ORIGIN = 'https://builder.aws.com';

function toArticleItem(article) {
  // Resolving against the origin (instead of string-concatenating) means a
  // uri like "//evil.example/x" or "https://evil.example/x" lands on another
  // origin and gets rejected here, rather than becoming a link on the public page.
  let url;
  try {
    url = new URL(article.uri, ARTICLE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ARTICLE_ORIGIN) return null;

  // lastPublishedAt is epoch milliseconds already, unlike badges'
  // awardedDate (epoch seconds) — no *1000 here. Checked explicitly because
  // new Date(null) is valid and silently becomes 1970-01-01 instead of
  // failing the NaN check below.
  if (!Number.isFinite(article.lastPublishedAt)) return null;
  const published = new Date(article.lastPublishedAt);
  if (Number.isNaN(published.getTime())) return null;

  // articleId is the table's sort key and title is the card's headline —
  // without either there is nothing to store or show. description is optional.
  if (!article.articleId || !article.title) return null;

  return {
    userId: USER_ID,
    articleId: article.articleId,
    title: article.title,
    description: article.description ?? null,
    url: url.href,
    publishDate: published.toISOString().slice(0, 10),
    tags: (article.tags || []).join(', '), // PublicPage.jsx renders this as a plain string, same as manual entries
    // Every visitor's browser fetches this, so only https from upstream.
    thumbnailUrl: /^https:\/\//i.test(article.heroImageUrl) ? article.heroImageUrl : null,
    updatedAt: new Date().toISOString(),
  };
}

// Receives in-progress badge counts from the Tampermonkey userscript
// (see tampermonkey/progress-sync.user.js) — it can't do an interactive
// Cognito login, so this route is protected by a shared secret header
// instead of the Cognito authorizer. No real AWS or Builder Center
// credential ever reaches this app; the secret only grants write access
// to this one table and is revocable by overwriting its SSM parameter (a
// warm container honors the old key for up to KEY_CACHE_MS). Deliberately
// ignores anything but IN_PROGRESS items — earned
// badges stay owned by syncBadges()/the sync button, so the two paths
// never write conflicting data for the same badgeId.
// Real catalog is 21 badges — this is slack, not a target, so a leaked
// SYNC_KEY still can't grow the table without bound.
const MAX_TOTAL_BADGES = 30;

async function progressSync(event) {
  // A failed SSM read throws out of here to the handler's catch: a 500 that
  // the API 5xx alarm picks up. It is not a 401, so an outage or a missing
  // parameter looks like the misconfiguration it is, not like a wrong guess.
  if (!hasValidSyncKey(event.headers?.['x-sync-key'], await getSyncKey())) {
    // The wording matters: ProgressSyncRejectedFilter in template.yaml
    // matches "progress-sync rejected" to drive the brute-force alarm. Never
    // log the submitted key itself.
    console.warn('progress-sync rejected', event.requestContext.http.sourceIp);
    return respond(401, { message: 'Unauthorized' });
  }

  const body = parseBody(event);
  if (!body) return respond(400, { message: 'Body must be a JSON object' });
  if (!isValidProgressItems(body.items)) {
    return respond(400, { message: 'items must be a non-empty array of {badgeId, name, progress}, max 25' });
  }

  const existing = await queryUserItems(TABLES.badges.name);
  const existingIds = new Set(existing.map((b) => b.badgeId));
  // A Set so one request repeating a fresh badgeId can't be counted twice —
  // or, the other way, slip extra new IDs past the cap.
  const newIds = new Set(body.items.map((i) => i.badgeId).filter((id) => !existingIds.has(id)));
  if (existing.length + newIds.size > MAX_TOTAL_BADGES) {
    return respond(400, { message: 'Too many distinct badges for this account' });
  }

  let synced = 0;
  for (const item of body.items) {
    // The per-key ConditionExpression below only protects a badge already
    // earned under this exact badgeId. It can't stop a stale payload that
    // reports the same badge under a *different* badgeId (e.g. a manually
    // entered earned record) — that write would succeed as a new item, and
    // removeStaleDuplicate would then delete the real earned record as the
    // "stale" one. Check by name up front to close that path too.
    if (existing.some((b) => b.name === item.name && b.status === 'earned' && b.badgeId !== item.badgeId)) {
      continue;
    }

    try {
      await client.send(
        new UpdateCommand({
          TableName: TABLES.badges.name,
          Key: { userId: USER_ID, badgeId: item.badgeId },
          // Guarded so a stale in-progress reading (e.g. an old browser tab)
          // can never downgrade a badge that syncBadges() has since marked
          // earned — earned badges stay owned by that path.
          UpdateExpression: 'SET #n = :n, #s = :s, #p = :p, #u = :u',
          ConditionExpression: 'attribute_not_exists(#s) OR #s <> :earned',
          ExpressionAttributeNames: { '#n': 'name', '#s': 'status', '#p': 'progress', '#u': 'updatedAt' },
          ExpressionAttributeValues: {
            ':n': item.name,
            ':s': 'in-progress',
            ':p': String(item.progress),
            ':u': new Date().toISOString(),
            ':earned': 'earned',
          },
        })
      );
      synced += 1;
    } catch (err) {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    }

    await removeStaleDuplicate(existing, item.name, item.badgeId);
  }

  return respond(200, { synced });
}

async function handleSettings(method, event) {
  try {
    if (method === 'GET') {
      const result = await client.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { userId: USER_ID } }));
      return respond(200, { ...DEFAULT_SETTINGS, ...result.Item });
    }

    if (method === 'PUT') {
      const body = parseBody(event);
      if (!body) return respond(400, { message: 'Body must be a JSON object' });
      if (!isValidTimezone(body.timezone)) {
        return respond(400, { message: `timezone must be one of: ${VALID_TIMEZONES.join(', ')}` });
      }
      const item = { userId: USER_ID, timezone: body.timezone, updatedAt: new Date().toISOString() };
      await client.send(new PutCommand({ TableName: SETTINGS_TABLE, Item: item }));
      return respond(200, item);
    }

    return respond(405, { message: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return respond(500, { message: 'Internal error' });
  }
}

async function queryUserItems(tableName) {
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': USER_ID },
    })
  );
  return result.Items || [];
}

// Badges are also written by syncBadges()/progressSync(), keyed on Builder
// Center's own badgeId. Manual admin entry has no way to know that ID ahead
// of time, so it upserts by name instead — otherwise a badge added by hand
// (the documented fallback when sync isn't running) and the same badge
// showing up later via sync would land as two separate records.
async function findBadgeByName(name) {
  const items = await queryUserItems(TABLES.badges.name);
  return items.find((b) => b.name === name);
}

// The reverse direction of the same problem: a badge added by hand first,
// under a random UUID, then confirmed later by real sync data under
// Builder Center's own badgeId. Once the authoritative record exists, the
// manual one is stale. `knownBadges` is a snapshot the caller already
// fetched, so this adds no extra reads per item.
async function removeStaleDuplicate(knownBadges, name, badgeId) {
  const stale = knownBadges.find((b) => b.name === name && b.badgeId !== badgeId);
  if (stale) {
    await client.send(
      new DeleteCommand({ TableName: TABLES.badges.name, Key: { userId: USER_ID, badgeId: stale.badgeId } })
    );
  }
}

// Caps a single request at 25 items (more than the whole badge catalog).
// The real backstop against a leaked key growing the table without bound
// is MAX_TOTAL_BADGES in progressSync(), not this per-request limit. The
// field-length and progress caps stop a leaked key from stuffing oversized
// strings into rows that every visitor's browser then downloads. Real
// badgeIds and names are far shorter than 200 characters.
const MAX_FIELD_LENGTH = 200;
const MAX_PROGRESS = 1_000_000;

function isValidProgressItems(items) {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 25 &&
    items.every(
      (i) =>
        i &&
        typeof i.badgeId === 'string' &&
        i.badgeId &&
        i.badgeId.length <= MAX_FIELD_LENGTH &&
        typeof i.name === 'string' &&
        i.name &&
        i.name.length <= MAX_FIELD_LENGTH &&
        Number.isFinite(i.progress) &&
        i.progress >= 0 &&
        i.progress <= MAX_PROGRESS
    )
  );
}

// The shared secret lives in SSM Parameter Store (a SecureString), not in the
// function's environment, so it isn't visible in the Lambda console or in
// stack parameters. Read lazily — only progress-sync needs it — and cached
// briefly so a burst of requests (or a flood of guesses) costs one SSM call
// instead of one each. The flip side is rotation lag: after
// `put-parameter --overwrite`, a warm container can keep accepting the old
// key for up to KEY_CACHE_MS.
const KEY_CACHE_MS = 5 * 60 * 1000;
let cachedSyncKey;
let cachedSyncKeyAt = 0;

async function getSyncKey() {
  if (cachedSyncKey !== undefined && Date.now() - cachedSyncKeyAt < KEY_CACHE_MS) return cachedSyncKey;
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: process.env.SYNC_KEY_PARAM, WithDecryption: true })
  );
  // A failed read throws before reaching here, so failures are never cached
  // and the next request retries. An empty value is cached like any other and
  // fails the comparison below; a missing one (undefined) isn't cached, so it
  // is re-read each request — still failing closed, just not memoized.
  cachedSyncKey = Parameter?.Value;
  cachedSyncKeyAt = Date.now();
  return cachedSyncKey;
}

function clearSyncKeyCache() {
  cachedSyncKey = undefined;
  cachedSyncKeyAt = 0;
}

// Compared as SHA-256 digests so timingSafeEqual always gets equal-length
// buffers (it throws otherwise) and the comparison time doesn't reveal how
// much of a guess matched. A missing key on either side is a rejection.
const digest = (s) => createHash('sha256').update(s).digest();

function hasValidSyncKey(provided, expected) {
  return Boolean(expected) && typeof provided === 'string' && timingSafeEqual(digest(provided), digest(expected));
}

// Returns the parsed body only when it's a plain JSON object, so callers can
// answer 400 for malformed JSON, `null`, or an array instead of throwing (a
// 500) or writing nonsense keys like "0" into DynamoDB.
function parseBody(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: body === null ? '' : JSON.stringify(body),
  };
}

// Builds a DynamoDB UpdateExpression from a plain object, skipping key fields.
// Returns null when there are no updatable fields.
function buildUpdateExpression(body, excludeKeys) {
  const fields = Object.keys(body).filter((k) => !excludeKeys.includes(k));
  if (fields.length === 0) return null;
  return {
    UpdateExpression: 'SET ' + fields.map((_, i) => `#f${i} = :v${i}`).join(', '),
    ExpressionAttributeNames: Object.fromEntries(fields.map((k, i) => [`#f${i}`, k])),
    ExpressionAttributeValues: Object.fromEntries(fields.map((k, i) => [`:v${i}`, body[k]])),
  };
}

module.exports.buildUpdateExpression = buildUpdateExpression;
module.exports.isValidProgressItems = isValidProgressItems;
module.exports.toArticleItem = toArticleItem;
module.exports.isValidTimezone = isValidTimezone;
module.exports.hasValidSyncKey = hasValidSyncKey;
module.exports.getSyncKey = getSyncKey;
module.exports.clearSyncKeyCache = clearSyncKeyCache;
module.exports.parseBody = parseBody;
