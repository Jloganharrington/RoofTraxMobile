// Machine-to-machine surface for the Brain (§5 of the app→Brain courier work
// order). Strictly read-only, gated by the SAME machine token the courier
// uses — never a browser/mobile session.
//
// GET /internal/photos/:photoId streams the raw evidence bytes so the Brain
// can fetch them INDEPENDENTLY of the submission envelope and re-hash them
// against the manifest. That independent fetch is the chain-of-custody claim;
// do not weaken it by inlining bytes into the envelope.
//
// Scope: only photos belonging to a LOCKED (submitted) inspection are
// servable. The token authorizes fetching submitted evidence, nothing else —
// a photo on an in-progress inspection is not yet evidence and is refused.
import { timingSafeEqual } from 'crypto';
import { Readable } from 'stream';

import { companiesTable, db, inspectionPhotosTable, inspectionsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';

import { getBrainConfig, type BrainMachineToken } from '../lib/brainCourier';
import { ObjectNotFoundError, ObjectStorageService } from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Resolves the presented bearer token to its scope. Returns the matched
 * token (whose companyId bounds what it may fetch: null ⇒ global) or null
 * when unauthorized. Every configured token is compared (timing-safe) so the
 * comparison count does not leak which token matched.
 */
function resolveMachineToken(req: Request): BrainMachineToken | null {
  const config = getBrainConfig();
  if (!config) return null; // courier disabled ⇒ no machine surface at all

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const presented = Buffer.from(header.slice('Bearer '.length));

  let matched: BrainMachineToken | null = null;
  for (const candidate of config.tokens) {
    const expected = Buffer.from(candidate.token);
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) {
      matched ??= candidate;
    }
  }
  return matched;
}

router.get('/internal/photos/:photoId', async (req: Request, res: Response) => {
  const scope = resolveMachineToken(req);
  if (!scope) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const photoId = req.params.photoId as string;
  const [row] = await db
    .select({
      photo: inspectionPhotosTable,
      lockedAt: inspectionsTable.lockedAt,
      companyId: inspectionsTable.companyId,
    })
    .from(inspectionPhotosTable)
    .innerJoin(inspectionsTable, eq(inspectionPhotosTable.inspectionId, inspectionsTable.id))
    .where(eq(inspectionPhotosTable.id, photoId));

  // 404 for "no such photo", "not submitted evidence yet", AND "outside this
  // token's company scope" — do not leak the distinction to a caller
  // probing ids.
  if (!row || !row.lockedAt || (scope.companyId !== null && row.companyId !== scope.companyId)) {
    res.status(404).json({ error: 'Photo not found' });
    return;
  }

  try {
    // Normalize legacy full-URL rows (stored before the mobile upload fix) to
    // the /objects/... path format that getObjectEntityFile expects.
    let objectPath = row.photo.url;
    if (objectPath.startsWith('http')) {
      try {
        const u = new URL(objectPath);
        const m = u.pathname.match(/\/storage\/objects\/(.+)$/);
        if (m) objectPath = `/objects/${m[1]}`;
      } catch { /* leave objectPath as-is and let getObjectEntityFile 404 */ }
    }
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: 'Photo bytes not found in storage' });
      return;
    }
    req.log.error({ err: error, photoId }, 'Error serving photo to Brain');
    res.status(500).json({ error: 'Failed to serve photo' });
  }
});

/**
 * Normalize a stored object URL/path (either a full authenticated URL or an
 * /api/storage/objects/... path) to the /objects/... form
 * getObjectEntityFile expects. Returns null when it isn't an object path.
 */
function toObjectPath(stored: string): string | null {
  let pathname = stored;
  if (stored.startsWith('http')) {
    try {
      pathname = new URL(stored).pathname; // discards query/fragment
    } catch {
      return null;
    }
  } else {
    // strip any query/fragment from a bare path
    pathname = pathname.split(/[?#]/, 1)[0] ?? pathname;
  }
  const m =
    pathname.match(/\/(?:api\/)?storage\/objects\/(.+)$/) ?? pathname.match(/^\/objects\/(.+)$/);
  return m ? `/objects/${m[1]}` : null;
}

// Company logo for the compiled Proof Package. Same machine-token gate and
// company scoping as photo evidence; the courier sends
// `objstore://company-logo/{companyId}` and the Brain resolves it here.
router.get('/internal/company-logo/:companyId', async (req: Request, res: Response) => {
  const scope = resolveMachineToken(req);
  if (!scope) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const companyId = req.params.companyId as string;
  // 404 for "no such company", "no logo", AND "outside this token's scope" —
  // do not leak the distinction.
  if (scope.companyId !== null && companyId !== scope.companyId) {
    res.status(404).json({ error: 'Logo not found' });
    return;
  }
  const [company] = await db
    .select({ logoUrl: companiesTable.logoUrl })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));
  if (!company?.logoUrl) {
    res.status(404).json({ error: 'Logo not found' });
    return;
  }

  try {
    const objectPath = toObjectPath(company.logoUrl);
    if (!objectPath) {
      res.status(404).json({ error: 'Logo not found' });
      return;
    }
    const file = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: 'Logo bytes not found in storage' });
      return;
    }
    req.log.error({ err: error, companyId }, 'Error serving company logo to Brain');
    res.status(500).json({ error: 'Failed to serve company logo' });
  }
});

export default router;
