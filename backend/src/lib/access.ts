import { HttpError, idParam, type Request } from './http';
import type { ClaimItem } from './items';
import { getClaimById } from './repo';

/** Every claim access goes through this check: the claim must belong to the signed-in user. */
export async function ownedClaim(req: Request): Promise<ClaimItem> {
  const claim = await getClaimById(idParam(req, 'id'));
  if (!claim || claim.userSub !== req.sub) throw new HttpError(404, 'not_found');
  return claim;
}
