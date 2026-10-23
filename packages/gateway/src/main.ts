import { configFromEnv } from './config.ts';
import { createGateway } from './server.ts';

const config = configFromEnv();
const { server } = createGateway(config);
server.listen(config.port, config.host, () => {
  // The key itself is never printed; only whether one is loaded.
  console.log(`[gateway] http://${config.host}:${config.port}  MODEL_API_KEY: ${config.apiKey ? 'loaded' : 'missing (Setup required)'}  runs: ${config.runsDir}`);
});
