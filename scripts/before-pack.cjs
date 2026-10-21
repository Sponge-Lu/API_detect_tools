module.exports = async context => {
  const { Arch } = require('builder-util');
  const { ensureChromium, CHROMIUM_VERSION } = await import('./fetch-chromium.mjs');
  await ensureChromium({
    platform: context.electronPlatformName,
    arch: Arch[context.arch],
    version: CHROMIUM_VERSION,
  });
};
