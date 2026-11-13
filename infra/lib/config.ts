import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGION = 'eu-central-1';

const here = path.dirname(fileURLToPath(import.meta.url));
export const INFRA_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(INFRA_DIR, '..');
export const BACKEND_HANDLERS_DIR = path.join(REPO_ROOT, 'backend', 'src', 'handlers');
export const FRONTEND_DIST_DIR = path.join(REPO_ROOT, 'frontend', 'dist', 'frontend', 'browser');
export const PLACEHOLDER_SITE_DIR = path.join(INFRA_DIR, 'placeholder-site');

/** Origin used for local development with `ng serve`. */
export const LOCAL_DEV_ORIGIN = 'http://localhost:4200';
