export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnvConfig } = await import('@/src/lib/config');
    validateEnvConfig();
  }
}
