import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';
import { LOGIN_PATH } from './paths';
import { rememberReturnTo } from './return-to';

/** Sends signed-out requests to /login and remembers where they wanted to go. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // init() resolves once with the state at page load. After a sign-in in the page, isAuthenticated() is current.
  await auth.init();
  if (auth.isAuthenticated()) return true;
  rememberReturnTo(state.url);
  return router.createUrlTree([LOGIN_PATH]);
};
