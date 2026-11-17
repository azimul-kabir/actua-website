// Deploy separately as a scheduled Worker; Pages does not run cron handlers.
export default {
  async scheduled(_event, env, context) {
    const endpoint = new URL(env.SUPPORTER_RECOVERY_ENDPOINT);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.pathname !== '/api/supporter/recovery/process' ||
      endpoint.search ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(env.SUPPORTER_RECOVERY_JOB_TOKEN ?? '')
    )
      throw new Error('Invalid recovery runner configuration');
    context.waitUntil(
      (async () => {
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(25000),
          headers: { Authorization: `Bearer ${env.SUPPORTER_RECOVERY_JOB_TOKEN}` },
        });
        if (!response.ok) throw new Error('Recovery runner unavailable');
      })(),
    );
  },
};
