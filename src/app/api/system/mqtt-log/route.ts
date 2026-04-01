import {
  getMqttLogsAfter,
  getRecentMqttLogs,
  type MqttLogEntry,
} from '@/lib/mqtt/logs';

export const dynamic = 'force-dynamic';

type MqttLogStreamMessage =
  | { type: 'snapshot'; entries: MqttLogEntry[] }
  | { type: 'entry'; entry: MqttLogEntry };

function encodeMessage(encoder: TextEncoder, message: MqttLogStreamMessage) {
  return encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const initialEntries = getRecentMqttLogs();
      let lastSeenId = initialEntries.at(-1)?.id ?? 0;

      controller.enqueue(
        encodeMessage(encoder, {
          type: 'snapshot',
          entries: initialEntries,
        })
      );

      const poll = setInterval(() => {
        try {
          const nextEntries = getMqttLogsAfter(lastSeenId);
          for (const entry of nextEntries) {
            controller.enqueue(encodeMessage(encoder, { type: 'entry', entry }));
            lastSeenId = entry.id;
          }
        } catch {
          cleanup();
        }
      }, 1000);

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          cleanup();
        }
      }, 30000);

      function cleanup() {
        clearInterval(poll);
        clearInterval(keepAlive);
      }

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
