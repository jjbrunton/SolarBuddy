export async function register() {
  // Only run on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { connectMqtt } = await import('./lib/mqtt/client');
    const { startCronJobs } = await import('./lib/scheduler/cron');

    console.log('[Init] Starting background services...');
    connectMqtt();
    startCronJobs();
  }
}
