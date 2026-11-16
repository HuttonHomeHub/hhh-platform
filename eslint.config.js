import { hhhConfig } from './packages/config/eslint.js';

// theme-init.js runs in the browser before first paint; the rest is Node.
export default hhhConfig({ browser: ['packages/ui/theme-init.js'] });
