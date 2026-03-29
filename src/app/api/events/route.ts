import { getState, onStateChange, type InverterState } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
          cleanup();
        }
      });

      // Keep-alive ping every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          cleanup();
        }
      }, 30000);

      function cleanup() {
        clearInterval(keepAlive);
        unsubscribe();
      }

      // Clean up when the client disconnects
      request.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
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
