import { ReverseGeocodeCoordinatesResponse } from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import { reverseGeocode } from '../lib/geocode';

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

export default router;
