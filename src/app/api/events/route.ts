import { getState, onStateChange, type InverterState } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send current state immediately
      const initial = `data: ${JSON.stringify(getState())}\n\n`;
      controller.enqueue(encoder.encode(initial));

      // Send updates on state change
      const unsubscribe = onStateChange((state: InverterState) => {
        try {
          const data = `data: ${JSON.stringify(state)}\n\n`;
          controller.enqueue(encoder.encode(data));
        } catch {
          unsubscribe();
        }
      });

      // Keep-alive ping every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(keepAlive);
          unsubscribe();
        }
      }, 30000);

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
      };

      // AbortSignal not available on ReadableStream start, so we rely on error handling above
      // The stream will error when the client disconnects, triggering cleanup in the catch blocks
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
