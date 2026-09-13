const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// single-user app: every item lives under the same fixed partition key
const USER_ID = 'me';

const TABLES = {
  badges: { name: process.env.BADGES_TABLE, idKey: 'badgeId' },
  articles: { name: process.env.ARTICLES_TABLE, idKey: 'articleId' },
};

exports.handler = async (event) => {
  // EventBridge Scheduler invokes the function directly (no API Gateway
  // envelope) for the nightly sync — everything below this expects a real
  // HTTP request, so branch off before touching event.requestContext.
  if (!event.requestContext) {
    return { synced: await syncBadges() };
  }

  const method = event.requestContext.http.method;
  const [, resource, id] = event.rawPath.split('/');
  const table = TABLES[resource];

  if (!table) {
    return respond(404, { message: 'Not found' });
  }

  try {
    if (method === 'POST' && resource === 'badges' && id === 'sync') {
      const synced = await syncBadges();
      return respond(200, { synced });
    }

    if (method === 'POST' && resource === 'badges' && id === 'progress-sync') {
      return progressSync(event);
    }

    if (method === 'GET') {
      const result = await client.send(
        new QueryCommand({
          TableName: table.name,
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': USER_ID },
        })
      );
      return respond(200, result.Items);
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const item = { ...body, userId: USER_ID, [table.idKey]: randomUUID() };
      await client.send(new PutCommand({ TableName: table.name, Item: item }));
      return respond(201, item);
    }

    if (method === 'PUT') {
      const body = JSON.parse(event.body || '{}');
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
      };
      await client.send(new PutCommand({ TableName: TABLES.badges.name, Item: item }));
      count += 1;
    }
    nextToken = data.nextToken;
  } while (nextToken);

  return count;
}

// Receives in-progress badge counts from the Tampermonkey userscript
// (see tampermonkey/progress-sync.user.js) — it can't do an interactive
// Cognito login, so this route is protected by a shared secret header
// instead of the Cognito authorizer. No real AWS or Builder Center
// credential ever reaches this app; the secret only grants write access
// to this one table and is trivially revocable by redeploying with a new
// value. Deliberately ignores anything but IN_PROGRESS items — earned
// badges stay owned by syncBadges()/the sync button, so the two paths
// never write conflicting data for the same badgeId.
async function progressSync(event) {
  if ((event.headers['x-sync-key'] || '') !== process.env.SYNC_KEY) {
    return respond(401, { message: 'Unauthorized' });
  }

  const body = JSON.parse(event.body || '{}');
  if (!isValidProgressItems(body.items)) {
    return respond(400, { message: 'items must be a non-empty array of {badgeId, name, progress}, max 25' });
  }

  for (const item of body.items) {
    await client.send(
      new UpdateCommand({
        TableName: TABLES.badges.name,
        Key: { userId: USER_ID, badgeId: item.badgeId },
        UpdateExpression: 'SET #n = :n, #s = :s, #p = :p',
        ExpressionAttributeNames: { '#n': 'name', '#s': 'status', '#p': 'progress' },
        ExpressionAttributeValues: { ':n': item.name, ':s': 'in-progress', ':p': String(item.progress) },
      })
    );
  }

  return respond(200, { synced: body.items.length });
}

// Caps at 25 (more than the whole badge catalog) so a leaked sync key
// can't be used to write an unbounded amount of data.
function isValidProgressItems(items) {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 25 &&
    items.every((i) => i && typeof i.badgeId === 'string' && i.badgeId && typeof i.name === 'string' && i.name)
  );
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
