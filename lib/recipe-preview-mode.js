export function recipePreviewEnabled(env) {
  if (env.VERCEL_ENV === 'production' || env.VERCEL_TARGET_ENV === 'production') return false;
  if (env.VERCEL_ENV === 'preview') return true;
  return env.VERCEL !== '1' && env.JULIA_PREVIEW_DEMO === '1';
}
