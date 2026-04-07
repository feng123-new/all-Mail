import { logger } from './lib/logger.js';
import { createJobsRuntime } from './runtime/processes.js';

async function main() {
    const runtime = createJobsRuntime();

    const shutdown = async () => {
        await runtime.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await runtime.start();
    } catch (err) {
        logger.error({ err }, 'Failed to start background jobs runtime');
        process.exit(1);
    }
}

void main();
