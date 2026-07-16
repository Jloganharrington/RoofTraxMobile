import {
  ReverseGeocodeCoordinatesResponse,
  SearchAddressResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import { reverseGeocode, searchAddress } from '../lib/geocode';

const router: IRouter = Router();

router.get('/geocode/reverse', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    res.status(400).json({ error: 'Invalid coordinates' });
    return;
  }

  const address = await reverseGeocode(latitude, longitude);
  res.json(ReverseGeocodeCoordinatesResponse.parse({ address }));
});

router.get('/geocode/search', async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q) {
    res.status(400).json({ error: 'Query parameter q is required' });
    return;
  }

  // Optional location bias: only apply when BOTH coordinates parse as finite
  // numbers, otherwise fall back to an unbiased search.
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const near =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : undefined;

  const results = await searchAddress(q, near);
  res.json(SearchAddressResponse.parse({ results }));
});

export default router;
